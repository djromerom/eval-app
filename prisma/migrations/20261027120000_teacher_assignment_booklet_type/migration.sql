-- Asignación docente ↔ asignatura-grado POR TIPO DE CUADERNILLO (oct 2026).
--
-- Antes: `TeacherSubjectAssignment` era (teacherId, courseSubjectId) — un
-- docente dictaba una asignatura-grado, sin importar el tipo de cuadernillo.
-- Ahora el tipo entra en la clave: el mismo docente puede estar asignado a
-- "Estándar" y a "Especial" de la misma asignatura-grado (el cuadernillo
-- Especial lo dicta otro docente).
--
-- `bookletTypeId` NULL = la asignación aplica a CUALQUIER tipo de cuadernillo
-- de esa asignatura-grado. Es el valor de las filas existentes (compat) y el
-- que usa la UI cuando el admin no marca un tipo concreto.
ALTER TABLE "TeacherSubjectAssignment" ADD COLUMN "bookletTypeId" UUID;

-- El unique viejo (teacherId, courseSubjectId) impediría asignar el mismo
-- docente a dos tipos de la misma asignatura-grado: se reemplaza por uno que
-- incluye el tipo.
DROP INDEX "TeacherSubjectAssignment_teacherId_courseSubjectId_key";
CREATE UNIQUE INDEX "TeacherSubjectAssignment_teacherId_courseSubjectId_bookletTypeId_key"
    ON "TeacherSubjectAssignment"("teacherId", "courseSubjectId", "bookletTypeId");

-- En Postgres NULL != NULL, así que el unique de arriba NO impide dos filas
-- (teacherId, courseSubjectId, NULL). Índice parcial para ese caso — mismo
-- patrón que `StudentEnrollment_studentId_isCurrent_key`.
CREATE UNIQUE INDEX "TeacherSubjectAssignment_teacherId_courseSubjectId_sinTipo_key"
    ON "TeacherSubjectAssignment"("teacherId", "courseSubjectId")
    WHERE "bookletTypeId" IS NULL;

CREATE INDEX "TeacherSubjectAssignment_bookletTypeId_idx"
    ON "TeacherSubjectAssignment"("bookletTypeId");

ALTER TABLE "TeacherSubjectAssignment"
    ADD CONSTRAINT "TeacherSubjectAssignment_bookletTypeId_fkey"
    FOREIGN KEY ("bookletTypeId") REFERENCES "BookletType"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
