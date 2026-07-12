# Módulo: academic

Estructura académica por institución: años académicos, cursos (grados), asignaturas
(catálogo global o propio), grupos, periodos y asignación docente ↔ curso+asignatura.
CRUDs del rol ADMIN (Fase 1 del roadmap).

- `domain/types.ts` — entidades, datos de creación, puertos de repositorio (acotados por `institutionId`) y validación (`isValidCode`, `isValidDateRange`).
- `application/` — casos de uso create+list por agregado (`academic-years`, `courses`, `subjects`, `groups`, `periods`). Autorización ADMIN; el catálogo global de asignaturas exige SUPER_ADMIN.
- `infrastructure/` — repos Prisma con mappers al shape del dominio + `container.ts`.

UI en `src/app/(dashboard)/admin/academic` (secciones con `EntityForm` genérico + server actions). Pendiente: edición/borrado, asignación docente↔curso+asignatura, marcar año actual desde la UI.
