#!/usr/bin/env bash
# ============================================================================
# Entrypoint del servicio `web` (Next.js standalone)
#
# El build standalone de Next produce .next/standalone/server.js que YA incluye
# su propio árbol de node_modules mínimo. Pero los assets servidos por el
# server (/.next/static) y los archivos del directorio public/ NO se copian
# automáticamente al output standalone — hay que enlazarlos manualmente.
#
# Si .next/static o public no existen (caso raro en CI sin `next build`),
# el script falla controlado.
# ============================================================================
set -euo pipefail

STANDALONE="/app/eval-app/.next/standalone"
APP_ROOT="/app/eval-app"

# Asegura que los assets estáticos estén junto al server.js.
if [ ! -d "${STANDALONE}/.next/static" ] && [ -d "${APP_ROOT}/.next/static" ]; then
  mkdir -p "${STANDALONE}/.next"
  cp -a "${APP_ROOT}/.next/static" "${STANDALONE}/.next/static"
fi

# public/ es opcional — solo se copia si existe en el build. No fallar si no.
if [ ! -d "${STANDALONE}/public" ] && [ -d "${APP_ROOT}/public" ]; then
  cp -a "${APP_ROOT}/public" "${STANDALONE}/public"
fi

# Los uploads persistentes viven fuera del bundle (volumen /var/eval/storage).
# Si la app los busca en STORAGE_DIR y el volumen está vacío al primer arranque,
# no es problema — la app los crea al primer write.

cd "${STANDALONE}"

# Healthcheck-friendly log: dejamos un banner en stderr (lo captura docker logs).
echo "[entrypoint-web] starting next standalone on :3000 (cwd: $(pwd))" >&2

exec node server.js