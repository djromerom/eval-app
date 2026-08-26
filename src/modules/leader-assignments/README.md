# Módulo `leader-assignments`

Asignación de un **Líder ECU** a un **curso entero** (todas sus asignaturas).
Espejo del módulo `teachers/` pero a nivel `Course` en vez de `CourseSubject`.

## Por qué un módulo aparte

Un líder pedagógico no imparte una sola asignatura — lidera un grado entero.
`TeacherSubjectAssignment` ata al docente a una `courseSubject` específica, lo
cual no escala al líder. Esta tabla ata al líder a un `courseId` y eso cubre
implícitamente todas las `courseSubject` del curso (no hace falta fila por
asignatura).

## Capas

```
domain/
  leader-assignment.ts              # LeaderAssignment, LeaderAssignmentRepository
application/
  leader-assignments.ts             # AssignLeader, UnassignLeader, ListLeaderAssignments
infrastructure/
  prisma-leader-assignment-repository.ts
  container.ts                      # makeAssignLeader, makeUnassignLeader, makeListLeaderAssignments
```

## Reglas de autorización

| Use case              | Roles permitidos | Notas |
|-----------------------|------------------|-------|
| `AssignLeader`        | `ECU_MASTER`     | Crea la fila `LeaderCourseAssignment(userId, courseId)`. Valida que el usuario tenga rol `ECU_LIDER` y que el curso sea de la institución. |
| `UnassignLeader`      | `ECU_MASTER`     | Idempotente. |
| `ListLeaderAssignments` | `ECU_MASTER`, `ECU_LIDER` | ECU_LIDER solo ve las suyas. ECU_MASTER ve todas (filtrable por `userId`). |

## Multi-tenant

La tabla **no** lleva `institutionId` propio. La tenancy viaja por la FK
`User → User.institutionId`. Cualquier `findAssignments` filtra por la
institución del actor desde la query (`where: { user: { institutionId } }`).

## Scope filter (feat/lider-ecu §3.4, §3.5)

`ListEvaluations` y `ListBundles` consultan
`assignments.listAssignedCourseIds(institutionId, userId)` para reducir la
vista del líder a los cursos que lidera. Sin asignaciones, la lista vuelve
vacía y `/coordinator` muestra un aviso ("Pide al admin que te asigne un
curso").

## UI

- Admin: `/admin/leader-assignments` (página + acciones server)
- Líder: ve el resultado indirectamente en `/coordinator` y `/admin/bundles`.
