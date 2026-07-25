#!/usr/bin/env bash
# ============================================================================
# first-cert-test.sh — emisión inicial del cert Let's Encrypt para STAGING
# (test.ecognia.pro + www.test.ecognia.pro)
#
# Gemelo de first-cert.sh pero:
#   - usa los dominios test.ecognia.pro y www.test.ecognia.pro
#   - NO toca el docker compose (staging es compose project separado)
#   - NO detiene nginx (prod ya está corriendo, hay que dejarlo); usa el
#     webroot plugin en lugar del standalone
#
# Requisitos:
#   - DNS A/AAAA de test.ecognia.pro y www.test.ecognia.pro ya apunta al VPS.
#   - nginx del host está corriendo (no lo paramos).
#
# Uso (en el VPS, con clave admin):
#   bash deploy/scripts/first-cert-test.sh
# ============================================================================
set -euo pipefail

: "${CERTBOT_EMAIL:?CERTBOT_EMAIL debe estar definido en el ambiente (export CERTBOT_EMAIL=admin@ecognia.pro)}"

DOMAIN="test.ecognia.pro"
WEBROOT="/var/www/certbot"

echo "[first-cert-test] Emitiendo cert para ${DOMAIN} + www.${DOMAIN} con email ${CERTBOT_EMAIL}…"

# Asegurar que el webroot existe (lo crea nginx del host en su config).
sudo mkdir -p "$WEBROOT"

sudo certbot certonly --webroot -w "$WEBROOT" \
    -d "$DOMAIN" -d "www.$DOMAIN" \
    --email "$CERTBOT_EMAIL" \
    --agree-tos \
    --no-eff-email \
    --rsa-key-size 4096

echo "[first-cert-test] Cert emitido. Verifica con: sudo certbot certificates"
echo "[first-cert-test] Siguiente paso: copiar deploy/nginx/test.ecognia.conf a"
echo "  /etc/nginx/sites-enabled/ y correr: sudo nginx -t && sudo systemctl reload nginx"
