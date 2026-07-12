# Arquitectura

Monolito modular sobre un único proyecto Next.js (App Router), desplegado en un
VPS (Linode) con PM2. Se evita a propósito la dispersión multi-servicio en la
nube (ver `../REQUERIMIENTOS_v2.md` §9).

## Capas por módulo (clean / hexagonal)

Cada contexto de negocio vive en `src/modules/<contexto>/` con tres capas:

```
src/modules/<contexto>/
  domain/          Entidades, reglas puras y PUERTOS (interfaces de repositorio).
                   Sin dependencias de framework ni de Prisma.
  application/     Casos de uso: orquestan reglas + autorización. Reciben sus
                   dependencias por constructor. Devuelven Result<T>, no lanzan.
  infrastructure/  ADAPTADORES: implementaciones Prisma de los puertos, y el
                   container.ts (composition root) que la presentación consume.
```

**Regla de dependencia** (forzada por ESLint `no-restricted-imports`): `domain`
y `application` **no** pueden importar `@prisma/client`. Solo `infrastructure`,
`src/app/**`, `workers/**` y `prisma/**` tocan Prisma.

El módulo `institutions` es la **implementación de referencia** del patrón
completo (dominio → caso de uso → repo Prisma → container → API/UI). Los demás
módulos (`evaluations`, `scanning`, `printing`, `users`, `academic`, `students`,
`question-bank`, `reporting`, `notifications`) están en distinto grado de avance.

## Manejo de errores

`src/shared/domain/result.ts` define `Result<T, E = DomainError>`. Los casos de
uso devuelven `ok(value)` / `fail(error)`; las excepciones quedan reservadas a
fallos de infraestructura inesperados. Los route handlers mapean el `code` del
`DomainError` a un status HTTP (ver `src/app/api/institutions/route.ts`).

## Autenticación y multi-tenancy

- **Auth.js** con estrategia JWT. El token lleva `id`, `institutionId` y `roles`
  para construir el `AuthenticatedUser` sin ir a la BD en cada request.
- `src/auth.config.ts` es edge-safe (lo usa el middleware); `src/auth.ts` (solo
  Node) añade el adapter Prisma y el provider de credenciales (bcrypt).
- Todo caso de uso recibe el `AuthenticatedUser` explícitamente y filtra por
  `institutionId`. PostgreSQL RLS es la segunda barrera (defensa en profundidad).

## Presentación (App Router)

```
src/app/
  (auth)/login              Login (credenciales; OAuth pendiente)
  (dashboard)/              Layout con sidebar por rol + requireAuthenticatedUser
    admin | coordinator | teacher
  print/evaluation/[id]     Cartilla imprimible (Print CSS @page tabloid)
  api/health                Healthcheck (verifica BD)
  api/auth/[...nextauth]    Handlers de Auth.js
  api/institutions          Ejemplo de API sobre casos de uso
```

## Procesamiento asíncrono

`src/shared/infrastructure/queue/queues.ts` define las colas BullMQ `omr-scan` y
`pdf-generation`. Los consumidores viven en `workers/` y corren como procesos PM2
independientes del servidor web (no bloquean request/response). Ver
[workers/README.md](./workers/README.md).

- **OMR**: `sharp` + heurística de detección de burbujas (umbrales 60/20). El
  microservicio Python/OpenCV es un fallback **solo si** la precisión < 95 %.
- **PDF**: método primario = imprimir desde el navegador; Puppeteer es el
  secundario para descarga masiva.

## Impresión

`src/styles/print.css` (Print CSS con `@page` tabloid 17×11 in) es el método
primario de PDF. `src/modules/printing/domain/print-spec.ts` fija las medidas
físicas y el orden de secciones de la portada. **Todo cambio de salida impresa
se valida contra `../Prueba__11º_I_periodo_C3__1_.pdf`** (§3.4 del spec).

## Datos

Prisma schema en `prisma/schema.prisma` (modelo del spec §4). Convenciones:
UUID v7 (`@default(uuid(7)) @db.Uuid`, ordenables), timestamps automáticos, y en
toda tabla de negocio `institutionId` + índice compuesto.

## Tests

- **Unitarios** (Vitest, `tests/unit/`): prueban dominio y casos de uso con
  repositorios en memoria — sin base de datos.
- **E2E** (Playwright, `tests/e2e/`): flujos sobre la app corriendo.
