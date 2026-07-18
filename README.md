# Eval

Plataforma multi-institucional para colegios colombianos: diseñar, imprimir y
**calificar automáticamente** evaluaciones tipo ICFES mediante lectura óptica de
marcas (OMR) e identificación por QR.

Especificación autoritativa: `../REQUERIMIENTOS_v2.md`. Arquitectura del código:
[ARCHITECTURE.md](./ARCHITECTURE.md).

## Stack

- **Next.js 15** (App Router) + **TypeScript** estricto
- **Prisma** + **PostgreSQL** (multi-tenant con `institutionId` + RLS)
- **Auth.js** (NextAuth v5): credenciales + Google/Microsoft
- **Tailwind v4** + Shadcn/ui
- **BullMQ** + **Redis** para el escaneo OMR y la generación de PDF (workers aparte)
- **sharp** para el preprocesamiento de imágenes OMR

Gestor de paquetes: **pnpm** (nunca npm).

## Puesta en marcha

```bash
# 1. Servicios locales (PostgreSQL + Redis)
docker compose up -d

# 2. Variables de entorno
cp .env.example .env   # y completa AUTH_SECRET y QR_SIGNING_SECRET
#   openssl rand -base64 32   → AUTH_SECRET
#   openssl rand -hex 32      → QR_SIGNING_SECRET

# 3. Dependencias + esquema + datos demo
pnpm install
pnpm db:migrate       # crea las tablas
pnpm db:seed          # institución demo + super admin (admin@eval.local / Admin1234!)

# 4. App
pnpm dev              # http://localhost:3000

# 5. Workers (en terminales aparte, requieren Redis)
pnpm worker:omr
pnpm worker:pdf
```

## Scripts

| Script                 | Qué hace                                        |
| ---------------------- | ----------------------------------------------- |
| `pnpm dev`             | Servidor de desarrollo                          |
| `pnpm build` / `start` | Build standalone / servir en producción         |
| `pnpm lint`            | ESLint (incluye la regla de capas domain→infra) |
| `pnpm typecheck`       | `tsc --noEmit`                                  |
| `pnpm test`            | Tests unitarios (Vitest)                        |
| `pnpm test:e2e`        | Tests E2E (Playwright)                          |
| `pnpm db:migrate`      | Migraciones de desarrollo                       |
| `pnpm db:seed`         | Datos de demostración                           |
| `pnpm db:studio`       | Prisma Studio                                   |
| `pnpm worker:omr`      | Worker de calificación OMR                      |
| `pnpm worker:pdf`      | Worker de generación de PDF                     |

## Deploy en producción

El deploy corre como Docker Compose en un VPS único con Nginx + Let's Encrypt
delante. Una sola imagen (`eval-app:latest`) con 3 entrypoints distintos
(`web`, `worker-omr`, `worker-pdf`).

Runbook completo + scripts + cron de renovación: **[`deploy/README.md`](./deploy/README.md)**.

Resumen rápido:

```bash
cd /opt/eval/eval-app
cp deploy/.env.prod.example .env.prod && chmod 600 .env.prod   # llenar secretos
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d postgres redis
docker compose -f docker-compose.prod.yml run --rm migrate
bash deploy/scripts/first-cert.sh                              # emite cert Let's Encrypt
docker compose -f docker-compose.prod.yml up -d
```

## Estado

Scaffold inicial (Fase 0/1). Los módulos de negocio están estructurados por
capas pero la mayoría son placeholders; ver los `README.md` de cada módulo en
`src/modules/` y el roadmap de 5 fases en `../REQUERIMIENTOS_v2.md`.
