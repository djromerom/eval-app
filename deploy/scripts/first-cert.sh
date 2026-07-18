#!/usr/bin/env bash
# ============================================================================
# Primera emisión de certificado Let's Encrypt para ecognia.pro
#
# Usa certbot STANDALONE: detiene cualquier cosa en puerto 80, deja que
# certbot levante su propio challenge server, emite el cert, y vuelve a
# arrancar nginx.
#
# Requisitos:
#   - DNS A/AAAA de ecognia.pro y www.ecognia.pro ya apuntan al VPS.
#   - .env.prod existe en el cwd con CERTBOT_EMAIL definido.
#   - nginx puede estar corriendo (lo detenemos nosotros) o no.
#
# Uso:
#   cd /opt/eval/eval-app
#   bash deploy/scripts/first-cert.sh
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/../.."

# Cargar CERTBOT_EMAIL del .env.prod (si existe).
if [ -f .env.prod ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.prod
  set +a
fi

: "${CERTBOT_EMAIL:?CERTBOT_EMAIL debe estar definido en .env.prod}"
: "${DOMAIN:=ecognia.pro}"

DOMAINS=("-d" "$DOMAIN" "-d" "www.$DOMAIN")

echo "[first-cert] Deteniendo nginx (si está corriendo) para liberar el puerto 80…"
docker compose -f docker-compose.prod.yml stop nginx 2>/dev/null || true

# Asegurar que el puerto 80 está libre localmente (puede haber otro servicio).
if ss -tlnp 2>/dev/null | grep -q ':80 '; then
  echo "[first-cert] ATENCIÓN: hay algo más escuchando en :80 además de docker."
  echo "[first-cert] Si el certbot falla, identificar y matar con: sudo ss -tlnp | grep :80"
fi

echo "[first-cert] Emitiendo cert para ${DOMAINS[*]} con email ${CERTBOT_EMAIL}…"

docker compose -f docker-compose.prod.yml run --rm certbot \
    certonly --standalone \
    "${DOMAINS[@]}" \
    --email "$CERTBOT_EMAIL" \
    --agree-tos \
    --no-eff-email \
    --rsa-key-size 4096

echo "[first-cert] Cert emitido. Levantando nginx…"
docker compose -f docker-compose.prod.yml up -d nginx

echo "[first-cert] Listo. Verifica con: docker compose -f docker-compose.prod.yml run --rm certbot certificates"