# Deploy de producción — eval-app

Stack completo de Next.js + Prisma + BullMQ corriendo como contenedores en un
VPS único detrás de Nginx + Let's Encrypt. Dos imágenes (`eval-app`,
`omr-service`) — la primera con 3 entrypoints distintos según el servicio
(`web`, `worker-omr`, `worker-pdf`).

## Arquitectura

```
Internet ──► :80/:443 Nginx (apt) ──► web:3000 (Next.js standalone)
                                 │
                                 ├─► postgres:16 (multi-tenant + RLS)
                                 └─► redis:7   (BullMQ: omr-scan, pdf-generation)
                                                  ▲
                                                  │
                                          worker-omr ─► omr-service:8000 (FastAPI)
                                          worker-pdf
                                            ▲
                                       (misma imagen eval-app, otros entrypoints)
```

`nginx`, `certbot` y `cron` corren como unidades del sistema en el host, no
como contenedores. Lo que está en docker-compose.prod.yml es **solo** la app:
postgres, redis, omr-service, web, worker-omr, worker-pdf y el contenedor
one-shot `migrate` (profile: `init`).

> Las imágenes las construye **GitHub Actions** y las sube a
> **GHCR** (`ghcr.io/djromerom/eval-app:git-<sha>` +
> `omr-service:git-<sha>`). El despliegue lo dispara el workflow `cd` en cada
> push a `main`. Ver la sección **[§CI/CD](#cicd)** al final.

Volúmenes nombrados (viven en `/var/lib/docker/volumes/`):

| Volumen           | Uso                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------- |
| `pgdata`          | Postgres 16 (bind mount interno, NO en host)                                            |
| `redisdata`       | Redis 7                                                                                 |
| `storage`         | Logos, hojas escaneadas, PDFs generados (`/var/eval/storage` dentro de `web` y workers) |
| `certs`           | `/etc/letsencrypt` (para nginx y certbot)                                               |
| `certbot-webroot` | `/.well-known/acme-challenge/`                                                          |

## Servicio omr-service (detección OMR en Python)

El `worker-omr` ya no detecta burbujas en TS: delega en el microservicio Python
`omr-service/` (FastAPI + OpenCV) por HTTP. Corre como un servicio más del
compose, **solo en la red interna** (puerto NO publicado al host, nginx NO lo
proxya). Imagen construida por CI/CD: `ghcr.io/djromerom/omr-service:git-<sha>`.

Definido directamente en `docker-compose.prod.yml` (no requiere setup extra):

```yaml
omr-service:
  image: ${OMR_SERVICE_IMAGE:-omr-service:latest} # CI exporta la versión pineada
  build: { context: ./omr-service, dockerfile: Dockerfile } # solo build local sin CI
  # sin `ports:` → solo accesible desde la red `eval-net`
  user: "1001:1001"
```

El `worker-omr` lo alcanza vía la variable de entorno
`OMR_SERVICE_URL=http://omr-service:8000` (que vive en `.env.prod`). En dev
local se usa `uvicorn main:app --port 8000` y la URL por defecto es
`http://127.0.0.1:8000`.

## Pre-requisitos

1. **VPS con Docker** — Ubuntu 22.04+ o Debian 12. Paquetes:
   ```bash
   curl -fsSL https://get.docker.com | sh
   apt install -y docker-compose-plugin
   ```
2. **DNS apuntando al VPS** — antes de emitir el cert:
   ```bash
   dig +short ecognia.pro        # debe devolver la IP del VPS
   dig +short www.ecognia.pro    # idem
   ```
3. **Puertos 80 y 443 libres** — el certbot standalone los necesita en la
   primera emisión. Si tienes algo escuchando ahí (Apache, otro nginx), matar
   primero: `sudo ss -tlnp | grep ':80\|:443'`.
4. **Arquitectura** — `uname -m`. Si es `aarch64` (Linode ARM), Chromium de
   Puppeteer viene x86_64 y falla. O construyes con `--platform=linux/amd64`
   o usas un VPS x86_64.

## Primer deploy

```bash
# 1. Clonar el repo en /opt/eval
sudo mkdir -p /opt/eval && sudo chown $USER /opt/eval
cd /opt/eval
git clone <repo-url> eval-app
cd eval-app

# 2. Crear .env.prod con secretos reales
cp deploy/.env.prod.example .env.prod
chmod 600 .env.prod
$EDITOR .env.prod
# Reemplazar __REPLACE_ME__ con salidas de openssl:
#   openssl rand -base64 24   (POSTGRES_PASSWORD, REDIS_PASSWORD)
#   openssl rand -base64 32   (AUTH_SECRET)
#   openssl rand -hex 32      (QR_SIGNING_SECRET)
# AUTH_URL=https://ecognia.pro (NO localhost, NO hostname interno)

# 3. Construir la imagen
docker compose -f docker-compose.prod.yml build

# 4. Arrancar Postgres y Redis (sin web todavía)
docker compose -f docker-compose.prod.yml up -d postgres redis

# 5. Aplicar migraciones (profile: init)
docker compose -f docker-compose.prod.yml run --rm migrate

# 6. Emitir el primer certificado (certbot standalone, nginx aún apagado)
docker compose -f docker-compose.prod.yml run --rm certbot \
    certonly --standalone \
    -d ecognia.pro -d www.ecognia.pro \
    --email "${CERTBOT_EMAIL}" --agree-tos --no-eff-email --rsa-key-size 4096

# 7. Arrancar nginx, web y los 2 workers
docker compose -f docker-compose.prod.yml up -d

# 8. Verificar
docker compose -f docker-compose.prod.yml ps
curl -I https://ecognia.pro/login
# Esperado: 200 con HSTS header
```

Alias recomendado (en `~/.bashrc` o `~/.zshrc`):

```bash
alias dp='docker compose -f docker-compose.prod.yml'
```

## Operaciones del día a día

### Actualizar la app (ahora vía CI/CD)

Cada push a `main` dispara el workflow `cd` de GitHub Actions, que construye
las 2 imágenes, las pushea a GHCR pineadas por SHA y redespliega vía SSH. **No
hace falta `git pull` + `dp build` manualmente** — el flujo automático lo hace.

Para forzar un redeploy de un SHA anterior sin hacer push nuevo: **Actions →
cd → Run workflow**, opcionalmente con `sha=<sha-anterior>`.

Logs del último deploy en la UI de GitHub Actions; salida del script en el VPS
`/var/log/eval-cd-script.log`; log del wrapper SSH en `/var/log/eval-cd.log`.

### Actualizar la app manualmente (sin CI)

Si el CI está caído y necesitas desplegar a mano:

```bash
cd /opt/eval/eval-app
git pull --ff-only
dp build                              # rebuild con el código nuevo (eval-app + omr-service)
dp up -d postgres redis               # asegurar infra de datos
dp run --rm migrate                   # si hay migraciones nuevas
dp up -d                              # reinicia servicios app que cambiaron
```

### Ver logs

```bash
dp logs -f web
dp logs -f worker-omr --tail=200
dp logs -f worker-pdf --tail=200
dp logs -f nginx                       # ver requests de los últimos N segundos
```

### Reiniciar un servicio

```bash
dp restart web
dp restart worker-omr
dp restart worker-pdf
```

### Inspeccionar la DB

```bash
# Conectarse a Postgres como el rol app (RLS activo) o eval (owner)
dp exec postgres psql -U eval -d eval
```

### Inspeccionar Redis

```bash
dp exec redis redis-cli -a "$REDIS_PASSWORD" ping
dp exec redis redis-cli -a "$REDIS_PASSWORD" LLEN bullmq:omr-scan:wait
dp exec redis redis-cli -a "$REDIS_PASSWORD" KEYS "bullmq:*"
```

### Renovación de certificados

El host corre `deploy/cron/eval-certbot` (instalar con `crontab -e` o copiando
a `/etc/cron.d/`). Cada noche a las 03:00 intenta renovar y hace reload de
nginx si hay cert nuevo.

Para probar manualmente:

```bash
dp run --rm certbot renew --dry-run
```

### Backup

**Postgres** (cron aparte, sugerido diario):

```bash
dp exec -T postgres pg_dump -U eval -d eval | gzip > /opt/eval/backups/db-$(date +%F).sql.gz
```

**Storage** (logos, hojas, PDFs — sugerido diario):

```bash
docker run --rm \
    -v eval-app_storage:/data:ro \
    -v /opt/eval/backups:/backup \
    alpine tar -czf /backup/storage-$(date +%F).tar.gz -C /data .
```

Restaurar:

```bash
# DB
gunzip -c db-2026-07-18.sql.gz | dp exec -T postgres psql -U eval -d eval

# Storage (¡CUIDADO: borra contenido actual!)
docker run --rm -v eval-app_storage:/data alpine sh -c "rm -rf /data/* && tar -xzf /backup/storage-2026-07-18.tar.gz -C /data"
```

### Recrear desde cero (desastre)

```bash
dp down -v              # borra contenedores Y volúmenes (PG, Redis, storage)
dp build
dp up -d postgres redis
dp run --rm migrate
dp run --rm certbot certonly --standalone ...   # reemitir certs
dp up -d
```

## CI/CD

Desde julio 2026 el deploy a producción está automatizado con GitHub Actions:

- **Trigger**: push a `main` (o `Actions → cd → Run workflow` con SHA manual).
- **Build** (paralelo): construye `eval-app` y `omr-service`, los pushea a
  GHCR pineados por SHA (`ghcr.io/<owner>/<image>:git-<sha>`). El tag `latest`
  se actualiza también para `main`.
- **Deploy**: SSH al VPS usando la clave de deploy y corre
  `deploy --sha <sha>` a través del wrapper restringido. cd.sh compone las
  imágenes a partir de `.env.prod` (`GHCR_OWNER` + `GHCR_IMAGE_BASE` + `<sha>`),
  hace pull, aplica migraciones y rollout de `omr-service/web/worker-omr/worker-pdf`.
- **Healthcheck**: tras el rollout, espera a que `web` quede `healthy` y
  al final el job hace `curl https://ecognia.pro/login` con 200 como criterio.

### Setup único (hecho, pero documentado para reposicionamiento)

1. **Generar clave SSH de deploy** (en el Mac del dev):

   ```bash
   ssh-keygen -t ed25519 -C "eval-deploy@ecognia.pro" -f ~/.ssh/id_ed25519_eval_deploy -N ""
   ```

2. **Instalar el wrapper y agregar la pública al VPS**:

   ```bash
   # copiar cd-wrapper.sh y cd.sh al VPS (o git pull)
   ssh -i <admin-key> root@<vps> '
     mkdir -p /opt/eval/bin
     install -m755 deploy/scripts/cd-wrapper.sh /opt/eval/bin/cd-wrapper.sh  # (ver Anexo §cd-wrapper.sh abajo)
     # Para authorized_keys (idempotente):
     PUB=$(cat ~/.ssh/id_ed25519_eval_deploy.pub)
     grep -q "eval-deploy@ecognia.pro" /root/.ssh/authorized_keys 2>/dev/null || \
       printf "command=\"/opt/eval/bin/cd-wrapper.sh\",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty %s\n" "$PUB" \
       >> /root/.ssh/authorized_keys
     chmod 600 /root/.ssh/authorized_keys
   '
   ```

   La opción `command=` en `authorized_keys` hace que cualquier intento de
   login con esa clave ejecute **solo** `cd-wrapper.sh`, que a su vez hace
   whitelist (`deploy <args>`). Aunque la clave se filtre, el atacante no
   puede abrir una shell libre.

3. **Configurar Secrets de GitHub** (Settings → Secrets and variables → Actions):
   - `VPS_HOST` — IP o dominio del VPS (ej. `177.7.42.54`)
   - `VPS_USER` — usuario SSH (ej. `root`)
   - `VPS_SSH_KEY` — contenido de `~/.ssh/id_ed25519_eval_deploy` (clave **privada**)

   ```bash
   # desde el Mac, copiar al portapapeles para pegarlo en GitHub:
   pbcopy < ~/.ssh/id_ed25519_eval_deploy
   ```

4. **Variables en `.env.prod` del VPS** (ya configurado):

   ```bash
   GHCR_OWNER=djromerom
   GHCR_IMAGE_BASE=ghcr.io
   ```

   Con esto + el `--sha` que pasa el workflow, cd.sh compone
   `ghcr.io/djromerom/eval-app:git-abc1234` sin necesidad de forwarding de
   env vars por SSH.

5. **Visibilidad de GHCR**: los paquetes se crean **públicos** (la imagen no
   contiene secretos — toda config sensible va por `.env.prod`). El VPS
   puede hacer pull sin autenticación. Si se prefiere mantenerlos privados,
   ver §Paquetes GHCR privados abajo.

### Operación

- **Ver el último deploy**: `gh run list --workflow=cd --limit=5` o ir a la
  pestaña Actions del repo en GitHub.
- **Forzar redeploy de un SHA anterior** sin hacer push nuevo:
  `Actions → cd → Run workflow → sha=<sha>`. Útil para rollback rápido.
- **Logs remotos** (VPS):
  - `/var/log/eval-cd.log` — wrapper SSH (BEGIN/DENY/RUN/END con RC y KEY-IP)
  - `/var/log/eval-cd-script.log` — output de cd.sh (pull, migrate, rollout,
    healthcheck, etc.)

### Cómo funciona el wrapper (seguridad)

`/opt/eval/bin/cd-wrapper.sh` es lo único que puede ejecutar la clave de
deploy (forzado por `command=` en `authorized_keys`). Su lógica:

1. Lee `SSH_ORIGINAL_COMMAND` (lo que el cliente pidió como comando).
2. Si está vacío → exit 1 (no shell interactiva).
3. Si el primer token no es `deploy` → exit 1.
4. En caso contrario, ejecuta `./deploy/scripts/cd.sh` con el resto de args.

Como `cd.sh` tiene `set -euo pipefail` y trata los args como datos (no los
interpreta con `eval`), no hay superficie para inyección.

### Anexo — `cd-wrapper.sh`

```bash
#!/bin/bash
set -euo pipefail
LOG=/var/log/eval-cd.log
echo "[--BEGIN-- $(date -Iseconds)] key=${SSH_CLIENT%% *} cmd=${SSH_ORIGINAL_COMMAND:-<no-command>}" >> "$LOG"

CMD="${SSH_ORIGINAL_COMMAND:-}"
[ -n "$CMD" ] || { echo "no command" >> "$LOG"; exit 1; }

FIRST="${CMD%% *}"
[ "$FIRST" = "deploy" ] || { echo "forbidden: $FIRST" >> "$LOG"; exit 1; }
REST="${CMD#deploy }"

cd /opt/eval/eval-app
# bash -c para word-split correcto de $REST.
bash -c "./deploy/scripts/cd.sh $REST" 2>> "$LOG"
RC=$?
echo "[--END-- $(date -Iseconds)] rc=$RC" >> "$LOG"
exit $RC
```

### Anexo — paquetes GHCR privados (opcional)

Si más adelante se prefiere que los paquetes sean privados:

1. Crear un PAT (fine-grained) con scope `read:packages` del owner del repo.
2. Agregar `GHCR_TOKEN` y `GHCR_USER` a `.env.prod` del VPS.
3. Agregar un paso al workflow `cd` (en la job `deploy`):
   ```yaml
   - name: docker login on VPS
     uses: appleboy/ssh-action@v1.1.0
     with:
       host: ${{ secrets.VPS_HOST }}
       username: ${{ secrets.VPS_USER }}
       key: ${{ secrets.VPS_SSH_KEY }}
       command: deploy --pre-login "${{ secrets.GHCR_USER }} ${{ secrets.GHCR_TOKEN }}"
   ```
   Y en `cd.sh`, antes del primer `pull`, hacer `docker login -u "$U" -p "$P" ghcr.io`
   si se pasó `--pre-login`.

No se hizo por defecto — los paquetes públicos simplifican el flujo y la
imagen no tiene secretos.

## Solución de problemas

### El worker PDF falla con "Acceso a /print rechazado"

`AUTH_URL` no coincide con el host público. Verificar:

```bash
dp exec worker-pdf printenv AUTH_URL   # debe ser https://ecognia.pro
```

Si está mal, editar `.env.prod`, reiniciar:

```bash
dp restart worker-pdf
```

### Nginx no arranca con "cannot load certificate"

Los certs no se emitieron o el volumen `certs` está vacío. Verificar:

```bash
dp run --rm certbot certificates
```

Si están expirados o vacíos, reemitir (con nginx apagado, paso 6).

### Worker OMR se reinicia en bucle

Probablemente no puede conectar a Redis. Verificar:

```bash
dp logs worker-omr --tail=50
dp exec redis redis-cli -a "$REDIS_PASSWORD" ping
```

Si Redis está healthy y el worker igual falla, verificar `REDIS_URL` en
`.env.prod` (debe tener la contraseña).

### El contenedor `web` arranca pero `curl localhost` devuelve 502

El entrypoint falló. Ver:

```bash
dp logs web --tail=100
```

Causas comunes:

- Falta `.next/static/` o `public/` en el bundle standalone (raro, el
  entrypoint-web.sh los copia).
- Las vars de entorno no validan (`AUTH_SECRET` muy corto, etc.).
- El puerto 3000 está ocupado dentro del contenedor (no debería, no exponemos
  al host).

### El deploy de CI/CD falla con "unknown shorthand flag: 'sha'"

Si alguien agregó cd.sh nuevo y agregó otra flag antes de `--sha`, GH Actions
puede haberse desincronizado. Verificar que la línea `command: deploy --sha
${{ steps.sha.outputs.value }}` en `.github/workflows/cd.yml` sigue
generando un comando que cd.sh entiende (debe empezar con `--sha` o `--skip`).

### El deploy queda colgado en "esperando que 'web' quede healthy"

El nuevo contenedor arrancó pero el healthcheck (`wget /login`) falla.
Inspeccionar:

```bash
ssh root@<vps> 'cd /opt/eval/eval-app && dp logs web --tail=100'
```

Causas comunes: variable de entorno faltante, runtime error de Next, o que
`AUTH_URL` apunta a un host distinto al que nginx sirve. Tras arreglar,
basta con re-disparar el workflow.

### `HEAD local (xxx) != SHA esperado (yyy)`

El VPS tiene el repo en un commit distinto al que pasó GH Actions. Sucede
porque `git pull` corre fuera del wrapper (es trabajo humano antes del push).
Solución: en el VPS correr `cd /opt/eval/eval-app && git pull --ff-only` y
luego re-disparar el workflow. Si es recurrente, vale la pena que el
wrapper haga pull antes (trade-off: el deploy depende del estado del repo
local).

## Riesgos conocidos

1. **DNS pre-issuance** — el A record de `ecognia.pro` y `www.ecognia.pro`
   debe apuntar al VPS **antes** del paso 6, sino certbot falla con
   "challenge failed".
2. **Puerto 80 libre en primera emisión** — certbot standalone lo necesita.
3. **ARM64 vs AMD64** — el Chromium de Puppeteer es x86_64 por defecto.
4. **Backups** — fuera del scope de este deploy, configurar aparte (sección
   arriba).
5. **`AUTH_URL`** — debe ser la URL pública. Si está mal, el worker PDF falla.
6. **Workers vía tsc** — si la compilación falla en build, no hay fallback
   porque `tsx` no está en runtime.
7. **Prisma CLI** — corre dentro de la imagen `eval-app:latest` (no necesita
   binario externo). El path al schema se pasa vía `PRISMA_SCHEMA_PATH`.

## Archivos clave

| Archivo                                   | Qué                                                           |
| ----------------------------------------- | ------------------------------------------------------------- |
| `Dockerfile`                              | Build multi-stage (builder + runtime)                         |
| `docker-compose.prod.yml`                 | Stack (postgres, redis, omr-service, web, 2 workers, migrate) |
| `omr-service/Dockerfile`                  | Imagen Python (OpenCV headless + FastAPI)                     |
| `docker/entrypoint-web.sh`                | Copia static/ y public/, luego exec node                      |
| `docker/entrypoint-worker.sh`             | Dispatch por `WORKER_NAME` a bundle compilado                 |
| `docker/nginx/nginx.conf`                 | Main config (buffers, timeouts, gzip)                         |
| `docker/nginx/conf.d/ecognia.conf`        | HTTP/HTTPS server blocks                                      |
| `tsconfig.worker.json`                    | Compila workers a `dist-workers/`                             |
| `deploy/.env.prod.example`                | Template de vars de prod                                      |
| `deploy/scripts/cd.sh`                    | Deploy idempotente invocado por GH Actions (CI/CD)            |
| `deploy/scripts/first-cert.sh`            | Helper para paso de emisión inicial del cert                  |
| `deploy/scripts/deploy.sh`                | Deploy manual local (sin CI/CD) — alternativa a `cd.sh`       |
| `deploy/cron/eval-certbot`                | Cron de renovación diaria                                     |
| `/opt/eval/bin/cd-wrapper.sh` (en el VPS) | Whitelist SSH para la deploy key de GH Actions                |
| `.github/workflows/cd.yml`                | Workflow de CD: build + push GHCR + SSH deploy                |
