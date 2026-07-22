# Deploy de producción — eval-app

Stack completo de Next.js + Prisma + BullMQ corriendo como contenedores en un
VPS único detrás de Nginx + Let's Encrypt. Una sola imagen (`eval-app:latest`)
y 3 entrypoints distintos según el servicio (`web`, `worker-omr`, `worker-pdf`).

## Arquitectura

```
Internet ──► :80/:443 Nginx ──► web:3000 (Next.js standalone)
                                 │
                                 ├─► postgres:16 (multi-tenant + RLS)
                                 └─► redis:7   (BullMQ: omr-scan, pdf-generation)
                                                  ▲
                                                  │
                                          worker-omr  ◄─┐
                                          worker-pdf  ◄─┘  (misma imagen, otros entrypoints)
```

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
proxya). Imagen: `omr-service/Dockerfile`.

Bloque para `docker-compose.prod.yml` (red interna del compose):

```yaml
omr-service:
  build: ./omr-service
  restart: unless-stopped
  # sin `ports:` — solo accesible desde la red del compose
  networks: [internal]
```

El `worker-omr` lo alcanza vía la variable de entorno
`OMR_SERVICE_URL=http://omr-service:8000` (nombre del servicio en la red del
compose). En dev local, en cambio, se corre `uvicorn main:app --port 8000` y la
URL por defecto es `http://127.0.0.1:8000`.

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

### Actualizar la app

```bash
cd /opt/eval/eval-app
git pull
dp build                              # rebuild con el código nuevo
dp up -d                              # reinicia servicios que cambiaron
dp run --rm migrate                   # si hay migraciones nuevas
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

| Archivo                            | Qué                                           |
| ---------------------------------- | --------------------------------------------- |
| `Dockerfile`                       | Build multi-stage (builder + runtime)         |
| `docker-compose.prod.yml`          | Stack completo (7 servicios, 2 perfiles)      |
| `docker/entrypoint-web.sh`         | Copia static/ y public/, luego exec node      |
| `docker/entrypoint-worker.sh`      | Dispatch por `WORKER_NAME` a bundle compilado |
| `docker/nginx/nginx.conf`          | Main config (buffers, timeouts, gzip)         |
| `docker/nginx/conf.d/ecognia.conf` | HTTP/HTTPS server blocks                      |
| `tsconfig.worker.json`             | Compila workers a `dist-workers/`             |
| `deploy/.env.prod.example`         | Template de vars de prod                      |
| `deploy/scripts/first-cert.sh`     | Helper para paso 6                            |
| `deploy/scripts/deploy.sh`         | build + migrate + up + ps                     |
| `deploy/cron/eval-certbot`         | Cron de renovación diaria                     |
