# Smoke test — Compendios Sprint 1

Verificación manual end-to-end del flujo "crear compendio → marcar listo →
descargar PDF". Asume que el entorno local está sano (Postgres + Redis +
worker PDF corriendo).

## Prerrequisitos

- Docker Desktop sano (sin overlay2 corrupto). Si los contenedores están
  pegados en "unhealthy", `docker compose down` falla o `docker images`
  devuelve vacío → **reiniciar Docker Desktop** antes de empezar.
- `.env` con `DATABASE_URL`, `AUTH_URL`, `AUTH_SECRET`, `QR_SIGNING_SECRET`,
  `STORAGE_DIR`, `REDIS_URL` (ver `.env.example`).
- Migración de bundles aplicada (ver paso 1).
- Una evaluación APPROVED o PUBLISHED en la BD (el wizard filtra por status).

## Paso 1 — Levantar la infraestructura

```bash
cd eval-app

# 1.1 Si quedaron contenedores zombies, matarlos primero.
docker compose down -v   # -v limpia los volúmenes (datos de prueba)

# 1.2 Recrear.
docker compose up -d

# 1.3 Esperar a que pasen los healthchecks.
docker compose ps
```

## Paso 2 — Aplicar migraciones y seed

```bash
# 2.1 Aplicar todas las migraciones (incluye la nueva 20260718000000_add_bundle_module).
pnpm db:migrate

# 2.2 Si la migración falla con "relation already exists" (por intentos
# previos), borrar la BD y volver a migrar:
#    docker exec -it eval-app-postgres-1 dropdb -U eval eval
#    docker exec -it eval-app-postgres-1 createdb -U eval eval
#    pnpm db:migrate

# 2.3 Seed mínimo: institución demo + super admin + estructura académica.
pnpm db:seed

# 2.4 Seed adicional: una evaluación APPROVED con preguntas, para que el
# wizard tenga candidatos. Ajustar el seeder si ya existe en tu entorno.
# (Ver prisma/seed.ts y prisma/seed-reference-evaluation.ts como base.)
```

## Paso 3 — Arrancar la app y el worker PDF

```bash
# 3.1 En una terminal: Next dev server.
pnpm dev

# 3.2 En otra terminal: worker PDF (necesario para la descarga del booklet).
pnpm worker:pdf
```

## Paso 4 — Flujo manual

1. **Login** como super admin (credenciales del seed → `prisma/seed.ts`).
2. Ir a `/admin/bundles` — debe mostrar lista vacía con botón "Nuevo compendio".
3. Click "Nuevo compendio" → wizard en `/admin/bundles/new`.
4. Llenar nombre (>= 3 chars), opcionalmente bookletNumber, seleccionar al
   menos una evaluación APPROVED/PUBLISHED de la lista, "Crear compendio".
5. La app redirige a `/admin/bundles/[id]`. Verificar:
   - Badge "Borrador".
   - Lista de items en orden.
   - Botones ↑/↓ y × funcionales.
   - "Añadir evaluación" muestra candidatos APPROVED/PUBLISHED no incluidos.
6. Editar nombre/bookletNumber desde el form "Metadatos". Guardar.
7. Click "Marcar como listo". El badge cambia a "Listo" y aparece el botón
   "Descargar PDF".
8. Click "Descargar PDF" → el worker procesa el job y devuelve el archivo
   `<id>-bundle.pdf`.
9. Abrir el PDF y comparar visualmente con `Prueba__11º_I_periodo_C3__1_.pdf`:
   - Portada con tabla de áreas (agrupadas por parentSubject).
   - "¡Hola!" + instrucciones + marca-ejemplo.
   - Booklet de cada evaluation con numeración continua.
   - Tabla "Qué competencias evaluamos" por evaluation.
   - Saddle-stitch imposition (imprimir a doble cara y doblar al centro).

## Paso 5 — Validaciones negativas (sanity)

- Intentar editar un compendio READY → debe fallar con "sellado".
- Intentar crear compendio con evaluaciones en DRAFT → debe fallar con
  "debe estar aprobada o publicada".
- Crear dos compendios con el mismo bookletNumber → debe fallar con
  "Ya existe un compendio con el número de cuadernillo N".
- Eliminar un compendio READY → debe fallar (solo DRAFT es eliminable).

## Comandos útiles para debug

```bash
# Cola PDF — ver jobs encolados.
docker exec -it eval-app-redis-1 redis-cli -p 6379 KEYS 'bull:pdf-generation:*'

# Storage — verificar PDFs generados.
ls -la storage/pdf/<institutionId>/

# Logs del worker (si corre por PM2 o por separado).
pnpm worker:pdf   # log a stdout/stderr
```

## Si algo falla

- **PDF no descarga / 504**: el worker PDF no está corriendo o Redis no
  responde. `docker compose ps` debe mostrar redis healthy.
- **PDF sale en blanco / 401**: `AUTH_URL` en `.env` debe ser la URL desde
  la que el navegador (o el worker) accede. Si usas `http://localhost:3000`,
  el token firmado es válido solo desde esa URL exacta.
- **Worker dice "Acceso a /print rechazado"**: token expiró (5 min TTL) o
  `QR_SIGNING_SECRET` cambió entre sign y verify.
