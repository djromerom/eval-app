#!/usr/bin/env bash
# ============================================================================
# cd.sh — Continuous Deployment para eval-app en el VPS de ecognia.pro
#
# Lo invoca GitHub Actions a través del wrapper SSH (única entrada permitida
# para la deploy key):
#   ssh root@<vps> "deploy --sha <git-sha>"
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
#   1. Verifica que SHA local == SHA pasado (defense-in-depth: nadie subió
#      tags manualmente).
#   2. Pull de las imágenes.
#   3. prisma migrate deploy (omitible con --skip-migrate).
#   4. Rollout sin downtime: omr-service + web + workers.
#   5. Espera a que `web` quede healthy (30 intentos × 2s = 60s).
#   6. Dump del estado final + prune de imágenes dangling.
#   7. Log a /var/log/eval-cd-script.log (rotación via logrotate externo).
#
# NO toca: postgres ni redis (nunca se recrean en cada deploy).
# ============================================================================
set -euo pipefail

REPO_DIR="/opt/eval/eval-app"
COMPOSE_FILE="docker-compose.prod.yml"
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
    --skip-migrate) SKIP_MIGRATE=1 ;;
    --sha)           EXPECTED_SHA="${2:-}"; shift ;;
    --sha=*)         EXPECTED_SHA="${1#*=}" ;;
    -h|--help)
      cat <<USAGE
Uso: deploy --sha <git-sha> [--skip-migrate]

Compone las imágenes a desplegar a partir de:
  - \$EVAL_APP_IMAGE / \$OMR_SERVICE_IMAGE (si vienen seteadas, p.ej. en dev)
  - o .env.prod: GHCR_OWNER + GHCR_IMAGE_BASE + <--sha>

Ejemplo:
  deploy --sha a1b2c3d4
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

cd "$REPO_DIR"
git config --global --add safe.directory "$REPO_DIR" 2>/dev/null || true

# ---------- Verificar SHA en el repo local ----------
ACTUAL=$(git rev-parse HEAD 2>/dev/null || echo "")
if [ "$ACTUAL" != "$EXPECTED_SHA" ]; then
  err "HEAD local ($ACTUAL) != SHA esperado ($EXPECTED_SHA)"
  err "¿el deploy se está corriendo sin pull? Abortando."
  exit 1
fi
log "SHA verificado: $(git rev-parse --short HEAD)"

# ---------- Componer imágenes ----------
# Si el caller las exportó (modo dev/staging), se respetan.
# Si no, se componen desde .env.prod + EXPECTED_SHA.
if [ -z "${EVAL_APP_IMAGE:-}" ] || [ -z "${OMR_SERVICE_IMAGE:-}" ]; then
  if [ ! -f ".env.prod" ]; then
    err ".env.prod no existe y las imágenes no fueron exportadas"
    exit 1
  fi
  chmod 600 .env.prod 2>/dev/null || true
  # Source .env.prod SIN ejecutar el resto del script con esos vars
  # exportados a nivel global — solo los usamos para componer.
  set +u
  # shellcheck disable=SC1091
  . ./.env.prod
  set -u

  GHCR_OWNER="${GHCR_OWNER:-?}"
  GHCR_IMAGE_BASE="${GHCR_IMAGE_BASE:-ghcr.io}"
  SHORT_SHA=$(echo "$EXPECTED_SHA" | cut -c1-7)
  EVAL_APP_IMAGE="${GHCR_IMAGE_BASE}/${GHCR_OWNER}/eval-app:git-${SHORT_SHA}"
  OMR_SERVICE_IMAGE="${GHCR_IMAGE_BASE}/${GHCR_OWNER}/omr-service:git-${SHORT_SHA}"
fi

# Exportar imágenes para que compose las vea en TODOS los servicios que
# referencian $EVAL_APP_IMAGE / $OMR_SERVICE_IMAGE.
export EVAL_APP_IMAGE OMR_SERVICE_IMAGE

log "imágenes:"
log "  eval-app    → $EVAL_APP_IMAGE"
log "  omr-service → $OMR_SERVICE_IMAGE"

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
