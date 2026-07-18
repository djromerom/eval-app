#!/usr/bin/env bash
# ============================================================================
# Entrypoint de los workers BullMQ (servicios `worker-omr` y `worker-pdf`).
#
# Compilamos workers TS → JS en /app/eval-app/dist-workers/ durante el build
# (tsconfig.worker.json). El entrypoint recibe la variable WORKER_NAME
# (definida por servicio en docker-compose.prod.yml) y dispatcha al bundle
# correspondiente. Sin tsx ni devDeps en la imagen runtime.
#
# Si WORKER_NAME no está seteado o el bundle no existe, salimos con código
# claro para que docker no quede reiniciando en bucle.
# ============================================================================
set -euo pipefail

: "${WORKER_NAME:?WORKER_NAME must be set (omr|pdf)}"

# tsc preserva la jerarquía de rootDir (./). Como workers/ está en la raíz
# del repo (no dentro de src/), los bundles viven en dist-workers/workers/.
BUNDLE="/app/eval-app/dist-workers/workers/${WORKER_NAME}.worker.js"

if [ ! -f "${BUNDLE}" ]; then
  echo "[entrypoint-worker] ERROR: bundle not found: ${BUNDLE}" >&2
  echo "[entrypoint-worker] El builder debería haberlo generado con:" >&2
  echo "[entrypoint-worker]   pnpm tsc -p tsconfig.worker.json" >&2
  echo "[entrypoint-worker]   pnpm tsc-alias -p tsconfig.worker.json" >&2
  exit 1
fi

echo "[entrypoint-worker] starting ${WORKER_NAME} (bundle: ${BUNDLE})" >&2

exec node "${BUNDLE}"