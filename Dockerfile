# syntax=docker/dockerfile:1.7
# =============================================================================
# eval-app — Dockerfile de producción
#
# Stack: Next.js 15 (standalone) + Prisma + workers BullMQ (OMR/PDF).
# Una sola imagen, 3 entrypoints distintos según el servicio compose:
#   - web          → /entrypoint/entrypoint-web.sh     (node server.js)
#   - worker-omr   → /entrypoint/entrypoint-worker.sh  (dist-workers/omr.worker.js)
#   - worker-pdf   → /entrypoint/entrypoint-worker.sh  (dist-workers/pdf.worker.js)
#
# Detalles clave:
#   - pnpm con --frozen-lockfile. Los build scripts permitidos (puppeteer,
#     sharp, prisma, esbuild, etc.) están declarados en
#     package.json > pnpm.onlyBuiltDependencies.
#   - Puppeteer 25.x descarga Chromium a $PUPPETEER_CACHE_DIR (no a
#     node_modules/.local-chromium como versiones antiguas). Fijamos la
#     variable a un dir dentro del proyecto y lo copiamos al runtime.
#   - Workers se compilan con `tsc` + `tsc-alias` (reescribe @/ -> src/)
#     porque sus imports usan path aliases que `tsc` no resuelve solo.
#   - El runtime NO incluye devDeps ni el CLI de Prisma. El contenedor
#     `migrate` (profile `init`) corre el CLI directamente desde
#     node_modules/@prisma (no necesitamos empaquetarlo aparte).
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: builder
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

ENV DEBIAN_FRONTEND=noninteractive \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    PUPPETEER_CACHE_DIR=/app/eval-app/.puppeteer-cache

# Tooling mínimo para compilar deps nativas (sharp, prisma engines, etc.)
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        python3 \
        build-essential \
        ca-certificates \
        openssl \
        unzip \
 && rm -rf /var/lib/apt/lists/*

# Habilita pnpm con la versión declarada en packageManager.
RUN corepack enable \
 && corepack prepare pnpm@10.1.0 --activate

WORKDIR /app/eval-app

# Copiamos solo manifests primero para que pnpm install quede en caché y no
# se invalide cuando cambie código fuente.
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma

# Install con lockfile. El postinstall (puppeteer) descarga Chromium al
# directorio PUPPETEER_CACHE_DIR; el postinstall de Prisma genera el cliente.
RUN pnpm install --frozen-lockfile

# Ahora el resto del código (capa invalidada por cambios de fuente).
COPY . .

# Variables dummy para que `next build` y `prisma generate` no fallen al
# importar `src/config/env.ts` (que valida DATABASE_URL/AUTH_SECRET/etc.).
# Estos valores nunca se usan en runtime — se sustituyen por los reales
# vía env_file en docker-compose.prod.yml.
ENV DATABASE_URL=postgresql://eval:eval@localhost:5432/eval?schema=public \
    AUTH_SECRET=build-time-dummy-secret-build-time-dummy-secret \
    QR_SIGNING_SECRET=build-time-dummy-hex-build-time-dummy-hex-build-time \
    NODE_ENV=production

# Regenera el cliente por si el schema cambió desde la última instalación.
RUN pnpm prisma generate

# Build standalone de Next.
RUN pnpm next build

# Compila workers TS → JS en dist-workers/ y reescribe los path aliases
# (@/ → src/) con tsc-alias para que node los resuelva sin TS.
RUN pnpm tsc -p tsconfig.worker.json \
 && pnpm tsc-alias -p tsconfig.worker.json

# Limpia devDependencies. Puppeteer y Chromium descargado se quedan (puppeteer
# es prodDep; el cache vive en .puppeteer-cache/ y lo copiamos al runtime).
# --ignore-scripts: salta el `postinstall: prisma generate` (prisma es devDep
# y ya corrimos `pnpm prisma generate` arriba, así que el cliente está listo).
RUN pnpm prune --prod --ignore-scripts

# -----------------------------------------------------------------------------
# Stage 2: runtime
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PUPPETEER_CACHE_DIR=/app/eval-app/.puppeteer-cache \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Libs de Chromium para Puppeteer + utilidades mínimas (tini para señales,
# wget para healthcheck, curl para debug, ca-certificates para TLS).
# `poppler-utils` es dependencia del worker `question-extract` (pdfinfo +
# pdftoppm/pdftocairo) — vive embebido en `src/lib/saber-extractor/`.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        ca-certificates \
        tini \
        wget \
        curl \
        poppler-utils \
        libnss3 \
        libnspr4 \
        libatk1.0-0 \
        libatk-bridge2.0-0 \
        libcups2 \
        libdrm2 \
        libdbus-1-3 \
        libxkbcommon0 \
        libxcomposite1 \
        libxdamage1 \
        libxrandr2 \
        libgbm1 \
        libpango-1.0-0 \
        libcairo2 \
        libasound2 \
        libatspi2.0-0 \
        libx11-xcb1 \
        libxshmfence1 \
        libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

# pnpm + prisma CLI globales: el contenedor `migrate` (profile init) corre
# `prisma migrate deploy` desde el nodo runtime. Costo ~50MB extra, pero
# evita tener una imagen separada solo para migraciones.
# IMPORTANTE: pin a la v6 para coincidir con @prisma/client en package.json.
# Prisma 7 introdujo cambios incompatibles (config en TS, sin `url` en schema).
RUN corepack enable \
 && corepack prepare pnpm@10.1.0 --activate \
 && npm install -g prisma@^6 --no-audit --no-fund

WORKDIR /app/eval-app

# Copia todo el árbol del builder. El standalone de Next vive en
# .next/standalone/ y los assets servidos por él en .next/static y public/.
COPY --from=builder /app/eval-app .

# Copia los entrypoints a /entrypoint/ (path fijo que usan los compose services)
# y hazlos ejecutables. Mantener la fuente en /app/eval-app/docker/ para
# que sigan commiteados en su lugar original del repo.
COPY --from=builder /app/eval-app/docker/entrypoint-web.sh    /entrypoint/entrypoint-web.sh
COPY --from=builder /app/eval-app/docker/entrypoint-worker.sh /entrypoint/entrypoint-worker.sh
RUN chmod +x /entrypoint/entrypoint-web.sh /entrypoint/entrypoint-worker.sh

# Usuario no-root para reducir blast radius si alguien rompe la app.
RUN groupadd --system --gid 1001 eval \
 && useradd --system --uid 1001 --gid eval --home-dir /var/eval --shell /usr/sbin/nologin eval \
 && mkdir -p /var/eval/storage \
 && chown -R eval:eval /app/eval-app /var/eval /entrypoint

# tini como init: reenvía señales y limpia zombies.
ENTRYPOINT ["/usr/bin/tini", "--"]

# Sin CMD fijo — cada servicio compose define el entrypoint script y los args.
#   web         → /entrypoint/entrypoint-web.sh
#   worker-omr  → /entrypoint/entrypoint-worker.sh (con WORKER_NAME=omr)
#   worker-pdf  → /entrypoint/entrypoint-worker.sh (con WORKER_NAME=pdf)
CMD ["node", "-e", "console.error('No CMD/entrypoint set; compose service must define one.')"]

# Volumen para logos institucionales, hojas escaneadas y PDFs generados.
VOLUME ["/var/eval/storage"]

EXPOSE 3000