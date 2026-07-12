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
