#!/usr/bin/env bash
# ============================================================================
# cd.sh — Continuous Deployment para eval-app en el VPS de ecognia.pro
#
# Lo invoca GitHub Actions a través del wrapper SSH (única entrada permitida
# para la deploy key):
#   ssh root@<vps> "deploy --sha <git-sha>"
#
# El VPS NO tiene código fuente ni un clone de git. Solo archivos estáticos:
#   /opt/eval/bin/cd.sh            (este script — versionado en el repo)
#   /opt/eval/bin/cd-wrapper.sh    (whitelist SSH dispatcher)
#   /opt/eval/eval-app/.env.prod   (variables, gitignored)
#   /opt/eval/eval-app/docker-compose.prod.yml
#
# Las imágenes a desplegar se COMPONEN en este script a partir de:
#   1. Variables exportadas por el caller (EVAL_APP_IMAGE / OMR_SERVICE_IMAGE),
#      si las hay — útil para entornos no-GHCR (dev/staging).
#   2. O, en su defecto, .env.prod del servidor:
#        GHCR_OWNER       — owner de GHCR (ej. djromerom)
#        GHCR_IMAGE_BASE  — registry (default: ghcr.io)
#      más el SHA pasado en --sha y el sufijo 'git-'.
#
# Ejemplo: con .env.prod conteniendo GHCR_OWNER=djromerom y --sha=abc1234,
# cd.sh compone:
#   EVAL_APP_IMAGE    = ghcr.io/djromerom/eval-app:git-abc1234
#   OMR_SERVICE_IMAGE = ghcr.io/djromerom/omr-service:git-abc1234
#
# Hace:
#   1. Pull de las imágenes nuevas desde GHCR.
#   2. prisma migrate deploy (omitible con --skip-migrate).
#   3. Rollout sin downtime: omr-service + web + workers.
#   4. Espera a que `web` quede healthy (30 intentos × 2s = 60s).
#   5. Dump del estado final + prune de imágenes dangling.
#   6. Log a /var/log/eval-cd-script.log (rotación via logrotate externo).
#
# NO toca: postgres ni redis (nunca se recrean en cada deploy).
# ============================================================================
set -euo pipefail

# APP_DIR y COMPOSE_FILE parametrizables via flag CLI / env var para soportar
# múltiples ambientes (prod + staging). Defaults apuntan a prod — el wrapper
# SSH inyecta los flags de staging cuando el primer token es `deploy-staging`.
APP_DIR="${APP_DIR:-/opt/eval/eval-app}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
LOG="/var/log/eval-cd-script.log"
LOCKFILE="/var/run/eval-cd.lock"

mkdir -p "$(dirname "$LOG")"
exec > >(tee -a "$LOG") 2>&1

log() { echo "[cd] $*"; }
err() { echo "[cd] ERROR: $*" >&2; }
trap 'err "failed at line $LINENO (rc=$?)"' ERR

log "===================================================="
log "$(date -Iseconds) eval-cd start"
log "argv: $*"
log "===================================================="

# ---------- Lock anti-concurrencia ----------
exec 9>"$LOCKFILE"
if ! flock -n 9; then
  err "otro deploy está en curso (lock: $LOCKFILE)"
  exit 1
fi

# ---------- Parse args ----------
SKIP_MIGRATE=0
EXPECTED_SHA=""
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-migrate)   SKIP_MIGRATE=1 ;;
    --sha)            EXPECTED_SHA="${2:-}"; shift ;;
    --sha=*)          EXPECTED_SHA="${1#*=}" ;;
    --env-dir)        APP_DIR="${2:?}"; shift ;;
    --env-dir=*)      APP_DIR="${1#*=}" ;;
    --compose)        COMPOSE_FILE="${2:?}"; shift ;;
    --compose=*)      COMPOSE_FILE="${1#*=}" ;;
    --image-tag-suffix)  IMAGE_TAG_SUFFIX="${2:?}"; shift ;;
    --image-tag-suffix=*) IMAGE_TAG_SUFFIX="${1#*=}" ;;
    -h|--help)
      cat <<USAGE
Uso: deploy --sha <git-sha> [--skip-migrate] [--env-dir <path>] [--compose <file>]
            [--image-tag-suffix <suffix>]

Compone las imágenes a desplegar a partir de:
  - \$EVAL_APP_IMAGE / \$OMR_SERVICE_IMAGE (si vienen seteadas, p.ej. en dev)
  - o .env en APP_DIR (default /opt/eval/eval-app/.env.prod):
      GHCR_OWNER + GHCR_IMAGE_BASE + <--sha> [+\$IMAGE_TAG_SUFFIX]

Flags:
  --env-dir <path>           directorio del env (default: \$APP_DIR o /opt/eval/eval-app)
  --compose <file>           nombre del compose (default: docker-compose.prod.yml)
  --image-tag-suffix <sfx>   sufijo para el tag (e.g. "-staging") — vacío en prod
  --skip-migrate             salta prisma migrate deploy
  --sha <git-sha>            SHA a desplegar (obligatorio)

Ejemplo:
  deploy --sha a1b2c3d4
  deploy-staging --sha a1b2c3d4 --skip-migrate
USAGE
      exit 0
      ;;
    *) err "argumento desconocido: $1"; exit 2 ;;
  esac
  shift
done

if [ -z "$EXPECTED_SHA" ]; then
  err "--sha es obligatorio"
  exit 2
fi

# ---------- Validar layout del VPS ----------
# Defensa mínima: si alguien borró .env.prod o el compose, fallar rápido y
# ruidoso en lugar de dejar al compose "funcionando" con defaults rotos.
if [ ! -d "$APP_DIR" ]; then
  err "$APP_DIR no existe — VPS no tiene el layout esperado (ver deploy/README.md)"
  exit 1
fi
if [ ! -f "$APP_DIR/$COMPOSE_FILE" ]; then
  err "$APP_DIR/$COMPOSE_FILE no existe — falta instalar docker-compose.prod.yml"
  exit 1
fi
if [ ! -f "$APP_DIR/.env.prod" ]; then
  err "$APP_DIR/.env.prod no existe — falta instalar el archivo de env (gitignored)"
  exit 1
fi

cd "$APP_DIR"
chmod 600 .env.prod 2>/dev/null || true

log "SHA a desplegar: $(echo "$EXPECTED_SHA" | cut -c1-7)"

# ---------- Cargar .env.prod en el entorno del proceso ----------
# BUG histórico: docker-compose.prod.yml usa interpolación obligatoria
# `${POSTGRES_PASSWORD:?...}` en bloques `environment:` — si esas vars
# no están exportadas en el shell del `docker compose pull`, falla con
# "required variable X is missing a value". `set -a` auto-exporta todo
# lo que se asigna durante el source.
set -a
# shellcheck disable=SC1091
. ./.env.prod
set +a

# ---------- Componer imágenes ----------
# Si el caller las exportó (modo dev/staging), se respetan.
# Si no, se componen desde .env.prod + EXPECTED_SHA.
if [ -z "${EVAL_APP_IMAGE:-}" ] || [ -z "${OMR_SERVICE_IMAGE:-}" ]; then
  GHCR_OWNER="${GHCR_OWNER:-?}"
  GHCR_IMAGE_BASE="${GHCR_IMAGE_BASE:-ghcr.io}"
  SHORT_SHA=$(echo "$EXPECTED_SHA" | cut -c1-7)
  TAG_SUFFIX="${IMAGE_TAG_SUFFIX:-}"
  EVAL_APP_IMAGE="${GHCR_IMAGE_BASE}/${GHCR_OWNER}/eval-app:git-${SHORT_SHA}${TAG_SUFFIX}"
  OMR_SERVICE_IMAGE="${GHCR_IMAGE_BASE}/${GHCR_OWNER}/omr-service:git-${SHORT_SHA}${TAG_SUFFIX}"
fi
set -u

# Exportar imágenes para que compose las vea en TODOS los servicios que
# referencian $EVAL_APP_IMAGE / $OMR_SERVICE_IMAGE.
export EVAL_APP_IMAGE OMR_SERVICE_IMAGE

log "imágenes:"
log "  eval-app    → $EVAL_APP_IMAGE"
log "  omr-service → $OMR_SERVICE_IMAGE"

# ---------- Auth check (GHCR paquetes privados) ----------
# El login a ghcr.io se hace UNA SOLA VEZ en el VPS con `docker login ghcr.io`
# (las credenciales quedan en /root/.docker/config.json, chmod 600). cd.sh
# no hace login en cada run — solo verifica que la auth está en su sitio
# y emite una guía clara si falta.
if [ -f /root/.docker/config.json ] && grep -q '"ghcr.io"' /root/.docker/config.json 2>/dev/null; then
  log "GHCR auth: detectada en /root/.docker/config.json"
else
  log "GHCR auth: NO detectada — si el pull falla con 'unauthorized',"
  log "  corre UNA vez en el VPS:    docker login ghcr.io"
  log "  con un PAT classic de scope 'read:packages'."
fi

# ---------- Pull ----------
log "pulling images…"
docker compose -f "$COMPOSE_FILE" pull --ignore-pull-failures \
  web worker-omr worker-pdf omr-service migrate

# ---------- Migraciones ----------
if [ "$SKIP_MIGRATE" = "0" ]; then
  log "esperando Postgres healthy…"
  for i in $(seq 1 15); do
    if docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U eval >/dev/null 2>&1; then
      break
    fi
    log "  postgres no listo aún ($i)"
    sleep 2
  done
  log "aplicando migraciones (prisma migrate deploy)…"
  docker compose -f "$COMPOSE_FILE" run --rm migrate
else
  log "--skip-migrate: saltando prisma migrate deploy"
fi

# ---------- Rollout ----------
log "rolling out: omr-service, web, workers…"
docker compose -f "$COMPOSE_FILE" up -d omr-service web worker-omr worker-pdf

# ---------- Healthcheck del web ----------
log "esperando que 'web' quede healthy…"
OK=0
for i in $(seq 1 30); do
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' eval-app-web-1 2>/dev/null || echo "missing")
  if [ "$STATUS" = "healthy" ]; then
    OK=1
    break
  fi
  log "  intento $i/30: status=$STATUS"
  sleep 2
done

if [ "$OK" != "1" ]; then
  err "'web' no llegó a healthy en 60s"
  log "---- docker compose ps ----"
  docker compose -f "$COMPOSE_FILE" ps || true
  log "---- web logs (últimas 100) ----"
  docker compose -f "$COMPOSE_FILE" logs --tail=100 web || true
  exit 1
fi

log "estado final:"
docker compose -f "$COMPOSE_FILE" ps

docker image prune -f >/dev/null 2>&1 || true

DOMAIN=$(grep '^DOMAIN=' .env.prod | cut -d= -f2)
log "DONE. Verificar con: curl -I https://${DOMAIN}/login"
log "===================================================="
log "$(date -Iseconds) eval-cd end (rc=0)"
log "===================================================="
