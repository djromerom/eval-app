#!/usr/bin/env bash
# ============================================================================
# render-nginx-conf.sh — deja los timeouts del reverse proxy en nginx
# funcionando con el MISMO valor que usa la app (variables de entorno).
#
# Por qué existe: la generación de PDFs puede tardar minutos (hoja de
# respuestas unificada de todo un grado). La cadena de timeouts es:
#
#   1. worker PDF:      PDF_RENDER_TIMEOUT_MS   (Chromium cargando /print)
#   2. app (Next.js):   PDF_QUEUE_WAIT_MS       (espera el job BullMQ)
#   3. nginx (host):    NGINX_PROXY_READ_TIMEOUT (si no, nginx corta antes
#                       que la app → 504 con HTML en vez del JSON de la app)
#
# nginx NO lee variables de entorno por sí solo: por eso este script
# reescribe las directivas `proxy_*_timeout` del vhost con el valor del env
# y recarga nginx. Los defaults viven en `.env.prod` (prod) y
# `.env.staging` (staging).
#
# Uso (en el VPS, como root):
#   bash deploy/scripts/render-nginx-conf.sh \
#     --conf /etc/nginx/sites-enabled/ecognia.conf \
#     --env-file /opt/eval/eval-app/.env.prod \
#     --reload
#
#   --check    No escribe nada: muestra el diff entre el archivo instalado y
#              lo que se escribiría con el env actual (sale 1 si difieren).
#   --reload   Tras escribir, corre `nginx -t` y recarga el servicio
#              (revierte el archivo si la config no valida).
#
# Variables leídas (con default si no están):
#   NGINX_PROXY_CONNECT_TIMEOUT  (default 60s)
#   NGINX_PROXY_SEND_TIMEOUT     (default 1200s)
#   NGINX_PROXY_READ_TIMEOUT     (default 1200s)
#   PDF_QUEUE_WAIT_MS            (default 900000) — solo para validar el orden
# ============================================================================
set -euo pipefail

CONF=""
ENV_FILE=""
RELOAD=0
CHECK=0

usage() {
  echo "Uso: render-nginx-conf.sh --conf <archivo> [--env-file <archivo>] [--reload] [--check]"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --conf) CONF="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    --reload) RELOAD=1; shift ;;
    --check) CHECK=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "argumento desconocido: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[ -n "$CONF" ] || { echo "--conf es obligatorio" >&2; usage >&2; exit 2; }
[ -f "$CONF" ] || { echo "no existe el vhost: $CONF" >&2; exit 2; }

if [ -n "$ENV_FILE" ]; then
  [ -f "$ENV_FILE" ] || { echo "no existe el env file: $ENV_FILE" >&2; exit 2; }
  # shellcheck disable=SC1090
  set -a
  . "$ENV_FILE"
  set +a
fi

CONNECT="${NGINX_PROXY_CONNECT_TIMEOUT:-60s}"
SEND="${NGINX_PROXY_SEND_TIMEOUT:-1200s}"
READ="${NGINX_PROXY_READ_TIMEOUT:-1200s}"
APP_WAIT_MS="${PDF_QUEUE_WAIT_MS:-900000}"

# --- Validación del orden: nginx debe aguantar MÁS que la app --------------
to_seconds() {
  local v="$1"
  case "$v" in
    *ms) echo $(( ${v%ms} / 1000 )) ;;
    *s)  echo "${v%s}" ;;
    *m)  echo $(( ${v%m} * 60 )) ;;
    *h)  echo $(( ${v%h} * 3600 )) ;;
    *)   echo "$v" ;;
  esac
}

read_s="$(to_seconds "$READ")"
app_s="$(( APP_WAIT_MS / 1000 ))"
if [ "$read_s" -le "$app_s" ]; then
  echo "ERROR: NGINX_PROXY_READ_TIMEOUT ($READ = ${read_s}s) no supera" >&2
  echo "       PDF_QUEUE_WAIT_MS ($APP_WAIT_MS = ${app_s}s)." >&2
  echo "       nginx cortaría la respuesta antes que la app → 504 con HTML." >&2
  echo "       Subí NGINX_PROXY_READ_TIMEOUT (o bajá PDF_QUEUE_WAIT_MS)." >&2
  exit 1
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

# Reescribe las tres directivas conservando el comentario que las etiqueta.
awk -v connect="$CONNECT" -v send="$SEND" -v read="$READ" '
{
  if ($0 ~ /proxy_connect_timeout/) {
    sub(/proxy_connect_timeout[[:space:]]+[^;]+;/, "proxy_connect_timeout " connect ";")
  }
  if ($0 ~ /proxy_send_timeout/) {
    sub(/proxy_send_timeout[[:space:]]+[^;]+;/, "proxy_send_timeout " send ";")
  }
  if ($0 ~ /proxy_read_timeout/) {
    sub(/proxy_read_timeout[[:space:]]+[^;]+;/, "proxy_read_timeout " read ";")
  }
  print
}
' "$CONF" > "$TMP"

echo "[render-nginx-conf] $CONF"
echo "  proxy_connect_timeout = $CONNECT"
echo "  proxy_send_timeout    = $SEND"
echo "  proxy_read_timeout    = $READ"
echo "  (PDF_QUEUE_WAIT_MS    = $APP_WAIT_MS → ${app_s}s; nginx aguant ${read_s}s)"

if [ "$CHECK" = "1" ]; then
  if diff -u "$CONF" "$TMP" > /dev/null 2>&1; then
    echo "  [check] el archivo instalado ya está sincronizado."
    exit 0
  fi
  echo "  [check] el archivo instalado está DESACTUALIZADO:"
  diff -u "$CONF" "$TMP" || true
  exit 1
fi

BAK="${CONF}.bak"
cp "$CONF" "$BAK"

cat "$TMP" > "$CONF"

if [ "$RELOAD" = "1" ]; then
  NGINX="nginx"
  if [ "$(id -u)" != "0" ] && command -v sudo > /dev/null 2>&1; then
    NGINX="sudo nginx"
  fi
  if ! $NGINX -t; then
    echo "ERROR: la config no valida → se restaura el backup." >&2
    cp "$BAK" "$CONF"
    exit 1
  fi
  if command -v systemctl > /dev/null 2>&1; then
    if [ "$(id -u)" != "0" ] && command -v sudo > /dev/null 2>&1; then
      sudo systemctl reload nginx
    else
      systemctl reload nginx
    fi
  fi
  echo "  nginx recargado."
else
  echo "  escrito (sin reload: corré 'nginx -t && systemctl reload nginx')."
fi
