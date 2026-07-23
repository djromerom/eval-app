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

### Layout del VPS (stateless — sin git)

El VPS **no tiene código fuente ni clone de git**. Solo archivos estáticos:

```
/opt/eval/
├── bin/
│   ├── cd-wrapper.sh     # SSH dispatcher (whitelist `deploy <args>`)
│   └── cd.sh              # deploy script (idempotente, este repo)
└── eval-app/
    ├── .env.prod          # variables de entorno (GITIGNORED — único dinámico)
    └── docker-compose.prod.yml
```

**Cómo se actualizan los archivos del VPS** (raro, manual):

| Archivo                   | Cuándo se toca                                 | Cómo                        |
| ------------------------- | ---------------------------------------------- | --------------------------- |
| `cd-wrapper.sh`           | Casi nunca (es la whitelist SSH)               | manual: `scp` desde el repo |
| `cd.sh`                   | Solo si cambia el deploy (nuevo servicio, fix) | manual: `scp` desde el repo |
| `docker-compose.prod.yml` | Solo si se agrega un servicio                  | manual: `scp` desde el repo |
| `.env.prod`               | Para rotar secretos o agregar vars             | manual: editar in-place     |

**Por qué NO hay `git clone`**: el chicken-and-egg de "para desplegar el
nuevo `cd.sh` necesitás hacer pull; para pull necesitás auth; para auth
necesitás un token que vence" no vale la pena. Las imágenes en GHCR YA
son inmutables (tag por SHA); no hace falta reconciliar estado del repo
local con el SHA que manda GH Actions — `cd.sh` ni mira `HEAD`.

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

## Primer deploy (instalación inicial — una sola vez)

El VPS arranca SIN código. La primera vez necesitás **un único git clone
temporal** para obtener `docker-compose.prod.yml`, `deploy/scripts/*`,
`Dockerfile` y la imagen de nginx/certbot. Una vez emitidos los certs y
arrancados los servicios, podés **borrar el clone** y pasar al modelo
stateless (sólo `scp` + CI/CD). Los pasos:

```bash
# 1. Crear el layout vacío y clonar el repo temporalmente
sudo mkdir -p /opt/eval && sudo chown $USER /opt/eval
sudo mkdir -p /opt/eval/bin
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
# GHCR_OWNER=<owner de GHCR, ej. djromerom>   ← requerido por cd.sh
# GHCR_IMAGE_BASE=ghcr.io                      ← requerido por cd.sh

# 3. Instalar los scripts de deploy en /opt/eval/bin (versión con whitelist)
sudo install -m755 deploy/scripts/cd.sh          /opt/eval/bin/cd.sh
sudo install -m755 deploy/scripts/cd-wrapper.sh  /opt/eval/bin/cd-wrapper.sh

# 4. Hacer el docker login a GHCR (si los paquetes son privados)
docker login ghcr.io -u <ghcr-user>           # pega PAT classic scope read:packages

# 5. Arrancar Postgres y Redis (sin web todavía)
docker compose -f docker-compose.prod.yml up -d postgres redis

# 6. Aplicar migraciones (profile: init)
docker compose -f docker-compose.prod.yml run --rm migrate

# 7. Emitir el primer certificado (certbot standalone, nginx aún apagado)
docker compose -f docker-compose.prod.yml run --rm certbot \
    certonly --standalone \
    -d ecognia.pro -d www.ecognia.pro \
    --email "${CERTBOT_EMAIL}" --agree-tos --no-eff-email --rsa-key-size 4096

# 8. Arrancar nginx, web y los 2 workers
docker compose -f docker-compose.prod.yml up -d

# 9. Instalar la deploy key con whitelist (ver §CI/CD → Setup único → paso 2)
# — requiere SSH admin root al VPS, NO la deploy key.

# 10. Verificar
docker compose -f docker-compose.prod.yml ps
curl -I https://ecognia.pro/login   # Esperado: 200 con HSTS header

# 11. Pasar al modelo stateless: borrar el clone
cd /opt/eval
rm -rf eval-app                    # cd.sh no necesita NUNCA un .git en el VPS
# Los archivos del compose ya están "vivos" en los named volumes; cd.sh los
# trae de GHCR en cada deploy y compose los lee desde /opt/eval/eval-app/.
# Copiá la versión "viva" con scp desde tu Mac:
#   scp docker-compose.prod.yml root@<vps>:/opt/eval/eval-app/docker-compose.prod.yml
#   scp deploy/.env.prod.example root@<vps>:/opt/eval/eval-app/.env.prod.example  # opcional
```

A partir de acá, deploys vía CI/CD. Si querés re-volver al modelo con repo
clonado (no se recomienda), basta con `git clone` otra vez en el mismo path.

Alias recomendado (en `~/.bashrc` o `~/.zshrc`):

```bash
alias dp='docker compose -f /opt/eval/eval-app/docker-compose.prod.yml'
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

### Actualizar archivos estáticos del VPS (raro, manual)

Los únicos archivos del VPS que cambian fuera de CI/CD son `cd.sh`,
`cd-wrapper.sh` y `docker-compose.prod.yml`. Cambian cuando se agrega un
servicio nuevo o se modifica la lógica del deploy — típicamente 1–2 veces al
año. Para actualizarlos, desde tu Mac:

```bash
# Copiá cada archivo al VPS (con backup automático del existente):
scp deploy/scripts/cd.sh          root@177.7.42.54:/opt/eval/bin/cd.sh
scp deploy/scripts/cd-wrapper.sh  root@177.7.42.54:/opt/eval/bin/cd-wrapper.sh
scp docker-compose.prod.yml      root@177.7.42.54:/opt/eval/eval-app/docker-compose.prod.yml
```

Los permisos tienen que quedar en 755 para los scripts (root los ejecuta
con sudo vía el wrapper SSH). `cd-wrapper.sh` debe seguir siendo propiedad
de root y NO tener permiso de escritura para nadie más (es la única
superficie de ataque de la deploy key).

### Actualizar la app manualmente (sin CI)

Si el CI está caído y necesitás desplegar a mano (no hay repo en el VPS,
las imágenes viven en GHCR; lo único que necesitás es el compose y tu
ghcr login vivo):

```bash
# Componer imágenes a partir del SHA que querés desplegar:
ssh root@<vps> 'cd /opt/eval/eval-app && \
  EVAL_APP_IMAGE=ghcr.io/<owner>/eval-app:git-<sha7> \
  OMR_SERVICE_IMAGE=ghcr.io/<owner>/omr-service:git-<sha7> \
  /opt/eval/bin/cd.sh --sha <sha-completo>'

# O, equivalentemente, disparar el workflow de GH Actions con sha manual:
# Actions → cd → Run workflow → sha=<sha>
```

NO uses `dp build` a mano: las imágenes en GHCR YA tienen el código, sólo
falta pedírselas al registry. Si querés re-construir localmente sin CI
(sólo en dev, no en este VPS), usá `deploy.sh` desde el repo clonado en
tu Mac y apuntá las vars `EVAL_APP_IMAGE` / `OMR_SERVICE_IMAGE` al tag
local.

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

2. **Instalar el wrapper y agregar la pública al VPS** (usa la **clave
   admin** del VPS, NO la deploy key):

   ```bash
   # 1. Copiar los scripts estáticos del repo al VPS (versión actual del repo)
   scp deploy/scripts/cd.sh          -i ~/.ssh/<admin-key> root@<vps>:/opt/eval/bin/cd.sh
   scp deploy/scripts/cd-wrapper.sh  -i ~/.ssh/<admin-key> root@<vps>:/opt/eval/bin/cd-wrapper.sh
   ssh -i ~/.ssh/<admin-key> root@<vps> 'chmod 755 /opt/eval/bin/cd.sh /opt/eval/bin/cd-wrapper.sh'

   # 2. Agregar la pública al authorized_keys del VPS con la whitelist
   #    (`command=` en authorized_keys es LO QUE HACE que la deploy key
   #    sólo pueda correr cd-wrapper.sh, no una shell libre)
   PUB=$(cat ~/.ssh/id_ed25519_eval_deploy.pub)
   ssh -i ~/.ssh/<admin-key> root@<vps> "
     grep -q 'eval-deploy@ecognia.pro' /root/.ssh/authorized_keys 2>/dev/null || \
       printf 'command=\"/opt/eval/bin/cd-wrapper.sh\",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty %s\n' '$PUB' \
       >> /root/.ssh/authorized_keys
     chmod 600 /root/.ssh/authorized_keys
   "
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

5. **Visibilidad de GHCR**: por defecto GHCR crea paquetes **privados**. Para
   que el VPS pueda hacer pull, hay que hacer `docker login ghcr.io` una vez
   en el VPS con un PAT de scope mínimo. Ver
   **[§Paquetes GHCR privados](#paquetes-ghcr-privados)** abajo — toma ~3
   minutos. (Si prefieres dejarlos públicos, ve a GitHub → Packages →
   eval-app / omr-service → Package settings → Change visibility → Public. La
   imagen no contiene secretos — toda config sensible va por `.env.prod`.)

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

Ésta es la versión que está en `deploy/scripts/cd-wrapper.sh` del repo. Se
invoca con `command="/opt/eval/bin/cd-wrapper.sh"` en `authorized_keys`.
Cualquier diferencia con tu VPS = diverge del repo (re-`scp` y `chmod 755`):

```bash
#!/bin/bash
# ============================================================================
# cd-wrapper.sh — SSH dispatcher para la deploy key de eval-app
#
# Se invoca desde `authorized_keys` con la restricción:
#   command="/opt/eval/bin/cd-wrapper.sh" ssh-ed25519 AAAA... eval-deploy
#
# Es la ÚNICA superficie de ataque de la deploy key. Aunque la clave se
# filtre, un atacante no puede abrir shell ni ejecutar otros comandos —
# este wrapper acepta solamente el primer token `deploy` y reenvía el
# resto verbatim a `cd.sh`. Cualquier otra cosa se loggea y se rechaza.
#
# Logs: /var/log/eval-cd.log (este wrapper) + /var/log/eval-cd-script.log
#       (cd.sh). Ambos rotan con logrotate externo.
# ============================================================================
set -euo pipefail
LOG=/var/log/eval-cd.log
mkdir -p "$(dirname "$LOG")"
echo "[--BEGIN-- $(date -Iseconds)] user=${USER:-?} cmd=${SSH_ORIGINAL_COMMAND:-<no-command>} key=${SSH_CLIENT%% *}" >> "$LOG"

CMD="${SSH_ORIGINAL_COMMAND:-}"
[ -z "$CMD" ] && {
  echo "deploy key — interactive shell denied" >&2
  echo "[--DENY-- $(date -Iseconds)] reason=no-command key=${SSH_CLIENT%% *}" >> "$LOG"
  exit 1
}

FIRST="${CMD%% *}"
REST="${CMD#${FIRST} }"
case "$FIRST" in
  deploy)
    echo "[--RUN-- $(date -Iseconds)] /opt/eval/bin/cd.sh $REST" >> "$LOG"
    /opt/eval/bin/cd.sh $REST
    RC=$?
    echo "[--END-- $(date -Iseconds)] rc=$RC" >> "$LOG"
    exit $RC
    ;;
  *)
    echo "deploy key — forbidden command: $FIRST" >&2
    echo "[--DENY-- $(date -Iseconds)] first=$FIRST key=${SSH_CLIENT%% *}" >> "$LOG"
    exit 1
    ;;
esac
```

Notas de seguridad:

- **NO** se usa `bash -c "$CMD …"`: ese patrón permite que cualquier cosa
  que cuele la whitelist (p.ej. `deploy a;rm -rf /`) ejecute código
  arbitrario. Acá sólo se whitelistea el primer token (`deploy`) y el
  resto se pasa como **args** a `cd.sh`, que los parsea con `case "$1" in`
  y rechaza cualquier `--foo` desconocido.
- Logs a `/var/log/eval-cd.log` (no rotados por el script — usar
  `logrotate` externo). Si el VPS no rota logs, este archivo crece sin
  tope.

### Anexo — Paquetes GHCR privados

Por defecto GHCR crea los paquetes como **privados**. Para que el VPS pueda
hacer `docker pull ghcr.io/djromerom/eval-app:git-<sha>` necesita autenticarse.
Hay que hacerlo **una sola vez** en el VPS; Docker persiste las credenciales
en `/root/.docker/config.json` (chmod 600, root). El workflow y cd.sh no
cambian — `docker compose pull` ya usa esa config automáticamente.

> Si prefieres no meterte con PATs: en GitHub ve a Packages → eval-app y
> omr-service → Package settings → Change visibility → Public. La imagen no
> contiene secretos — toda config sensible va por `.env.prod`. Esta opción
> es de un solo click y deja el VPS sin auth que mantener.

#### Paso 1 — Crear un PAT fine-grained (scope mínimo)

1. `https://github.com/settings/personal-access-tokens/new` (o desde el avatar →
   Settings → Developer settings → Personal access tokens → Fine-grained tokens
   → **Generate new token**).
2. **Token name**: `eval-cd-pull` (o el que prefieras).
3. **Resource owner**: `djromerom`.
4. **Expiration**: 90 días (renovable).
5. **Repository access**: Only select repositories → **`djromerom/eval-app`**.
6. **Permissions** (buscar "packages" en el dropdown):
   - **Packages**: Read-only
   - (Metadata: Read-only viene por default, dejarlo así.)
7. **Generate token** → **copiar el token** (empieza con `github_pat_…`). Es la
   única vez que se muestra — guárdalo seguro.

> El blast radius de este PAT es: leer paquetes del repo eval-app. No puede
> tocar código, ni PRs, ni escribir en ningún lado. Si se filtra, el daño
> potencial es bajo.

#### Paso 2 — (Opcional) Agregar los Secrets a GitHub

Útil para referencia / futura rotación / scripts que quieran regenerar el
login. cd.sh NO los lee — el login se persiste en disco y se hace offline:

- Settings → Secrets and variables → Actions → **New repository secret**:
  - `GHCR_USER` = `djromerom`
  - `GHCR_TOKEN` = el PAT del paso 1 (`github_pat_…`)

#### Paso 3 — Login una sola vez en el VPS

```bash
# Desde tu Mac, vía SSH con la clave admin (NO la deploy key):
ssh -i ~/.ssh/id_ed25519_solinces root@177.7.42.54

# Una vez adentro:
docker login ghcr.io -u djromerom
# pegará un prompt — pegar el PAT del paso 1. Verás:
#   Login Succeeded
```

Docker persiste las credenciales en `/root/.docker/config.json`. Para
verificar:

```bash
ls -l /root/.docker/config.json        # debe ser -rw------- root root
grep ghcr.io /root/.docker/config.json # debe listar la entrada
```

A partir de acá, **todos los deploys** que haga `docker compose pull` usarán
esa auth. No hay nada más que hacer.

#### Cuándo renovar el login

- Cuando el PAT expire (90 días) → generar uno nuevo y repetir el paso 3.
- Si el deploy falla con `unauthorized: GHCR` o similar → el PAT expiró o se
  revocó. cd.sh imprime una guía clara si detecta que la auth no está.

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

Si alguien tocó cd.sh y agregó otra flag antes de `--sha`, GH Actions
puede haberse desincronizado. El campo correcto en `appleboy/ssh-action@v1.1.0`
es **`script:`**, NO `command:` (eso lanza un warning en los logs).
Verificar la línea:

```yaml
- uses: appleboy/ssh-action@v1.1.0
  with:
    script: deploy --sha ${{ steps.sha.outputs.value }}
```

### El deploy queda colgado en "esperando que 'web' quede healthy"

El nuevo contenedor arrancó pero el healthcheck (`wget /login`) falla.
Inspeccionar:

```bash
ssh root@<vps> 'cd /opt/eval/eval-app && dp logs web --tail=100'
ssh root@<vps> 'tail -200 /var/log/eval-cd-script.log'
```

Causas comunes: variable de entorno faltante, runtime error de Next, o que
`AUTH_URL` apunta a un host distinto al que nginx sirve. Tras arreglar,
basta con re-disparar el workflow.

### El deploy falla con "unauthorized" al hacer pull de GHCR

El `docker login ghcr.io` del VPS expiró o el PAT fue revocado. cd.sh emite
una guía clara en sus logs cuando detecta que falta auth. Para arreglar:

```bash
ssh root@<vps> 'docker login ghcr.io -u djromerom'
# pegar el PAT (generar uno nuevo si el anterior expiró)
```

Ver §Paquetes GHCR privados abajo.

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

| Archivo                                                  | Qué                                                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `Dockerfile`                                             | Build multi-stage de `eval-app` (builder + runtime)                                     |
| `docker-compose.prod.yml`                                | Stack en el VPS (postgres, redis, omr-service, web, 2 workers, migrate, nginx, certbot) |
| `omr-service/Dockerfile`                                 | Imagen Python (OpenCV headless + FastAPI)                                               |
| `docker/entrypoint-web.sh`                               | Copia static/ y public/, luego exec node                                                |
| `docker/entrypoint-worker.sh`                            | Dispatch por `WORKER_NAME` a bundle compilado                                           |
| `docker/nginx/nginx.conf` + `conf.d/*.conf`              | Main config + HTTP/HTTPS server blocks                                                  |
| `tsconfig.worker.json`                                   | Compila workers a `dist-workers/`                                                       |
| `deploy/.env.prod.example`                               | Template de vars de prod                                                                |
| `deploy/scripts/cd.sh`                                   | Deploy idempotente invocado por GH Actions (CI/CD)                                      |
| `deploy/scripts/cd-wrapper.sh`                           | Versión de referencia del whitelist SSH (la del VPS está en `/opt/eval/bin`)            |
| `deploy/scripts/first-cert.sh`                           | Helper para emisión inicial del cert (sólo en instalacion inicial)                      |
| `deploy/scripts/deploy.sh`                               | Deploy manual con git local (dev/disaster recovery; NO usar en prod stateless)          |
| `deploy/cron/eval-certbot`                               | Cron de renovación diaria                                                               |
| `/opt/eval/bin/cd-wrapper.sh` (en el VPS)                | Whitelist SSH para la deploy key de GH Actions (sync con el repo)                       |
| `/opt/eval/bin/cd.sh` (en el VPS)                        | Deploy script (sync con el repo)                                                        |
| `/opt/eval/eval-app/.env.prod` (en el VPS)               | Variables de entorno (único archivo dinámico; gitignored)                               |
| `/opt/eval/eval-app/docker-compose.prod.yml` (en el VPS) | Compose de prod (sync con el repo)                                                      |
| `.github/workflows/cd.yml`                               | Workflow de CD: build + push GHCR + SSH deploy                                          |
