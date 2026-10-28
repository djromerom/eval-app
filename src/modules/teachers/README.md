# Módulo: teachers

Docentes y su asignación a asignaturas-curso (REQUERIMIENTOS_v2.md §3.2). Un
docente es un **usuario con rol TEACHER + perfil** (documento, teléfono); como el
schema exige `Teacher.userId`, crear un docente crea también su cuenta (invitada,
inactiva hasta que ingrese).

- `domain/teacher.ts` — entidad, datos de creación, `TeacherAssignment`, puerto
  `TeacherRepository` y validación (`TEACHER_ID_TYPES`).
- `application/teachers.ts` — `CreateTeacher` (crea usuario+perfil), `ListTeachers`,
  `AssignTeacher` (valida docente y asignatura-curso), `ListTeacherAssignments`.
- `infrastructure/` — repo Prisma (transacción usuario+perfil, joins a
  `CourseSubject`) + container (reusa `PrismaCourseSubjectRepository` de academic).

UI en `src/app/(dashboard)/admin/teachers`. Depende de que existan enlaces
asignatura↔curso (`CourseSubject`), gestionados en `/admin/academic`.
Pendiente: quitar asignaciones, edición de perfil, reenvío de invitación.

## Asignación por tipo de cuadernillo (oct 2026)

`TeacherSubjectAssignment` incluye `bookletTypeId`: la asignación docente ↔
asignatura-grado ahora es **por tipo de cuadernillo** (el cuadernillo "Especial"
lo dicta un docente distinto del "Estándar").

- `bookletTypeId = null` → la asignación aplica a **cualquier** tipo de
  cuadernillo de esa asignatura-grado. Es el valor de las filas anteriores al
  sprint (compat) y el que usa la UI cuando la institución no tiene tipos
  configurados.
- El tipo debe colgar de una Prueba del **mismo año académico** que el grado
  (`AssignTeacher` lo valida), si no la asignación nunca aplicaría.

En Postgres `NULL != NULL`, así que el `@@unique` del schema (que incluye la
columna nullable) no impide dos filas `(teacher, asignatura-grado, NULL)`: la
migración `20261027120000_teacher_assignment_booklet_type` agrega un índice
único **parcial** para ese caso (mismo patrón que
`StudentEnrollment_studentId_isCurrent_key`). El duplicado exacto se valida
además en aplicación (`TeacherRepository.isAssigned`).

Consumidores:

- Admin (`/admin/teachers`): form encadenado **Grado → Asignatura → Tipo de
  cuadernillo** (`_components/teacher-assignment-form.tsx`).
- Consultas ("listado de formulaciones"): `assignedTeachers` cruza la
  asignación por `(courseSubjectId, bookletTypeId)` + las asignaciones "para
  cualquier tipo".
- Docente (`/teacher/evaluations`): el select "Tipo de cuadernillo" solo
  ofrece los tipos asignados para la asignatura-grado elegida.
