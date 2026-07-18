#!/usr/bin/env bash
# ============================================================================
# Helper de deploy: pull/build/migrate/up. Asume que el repo está en
# /opt/eval/eval-app y que .env.prod existe en el cwd.
#
# Uso:
#   cd /opt/eval/eval-app
#   bash deploy/scripts/deploy.sh
#
# O sin git pull (deploy local con código ya actualizado):
#   SKIP_PULL=1 bash deploy/scripts/deploy.sh
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/../.."

if [ "${SKIP_PULL:-0}" != "1" ] && [ -d .git ]; then
  echo "[deploy] git pull…"
  git pull --ff-only
fi

echo "[deploy] docker compose build…"
docker compose -f docker-compose.prod.yml build

echo "[deploy] subiendo postgres y redis…"
docker compose -f docker-compose.prod.yml up -d postgres redis

echo "[deploy] esperando healthcheck de postgres…"
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if docker compose -f docker-compose.prod.yml exec -T postgres pg_isready -U eval >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "[deploy] aplicando migraciones…"
docker compose -f docker-compose.prod.yml run --rm migrate

echo "[deploy] up del resto (nginx, web, workers)…"
docker compose -f docker-compose.prod.yml up -d

echo "[deploy] estado final:"
docker compose -f docker-compose.prod.yml ps

echo "[deploy] HECHO. Verificar con: curl -I https://$(grep '^DOMAIN=' .env.prod | cut -d= -f2)/login"