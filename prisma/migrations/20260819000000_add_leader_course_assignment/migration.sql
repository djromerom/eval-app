-- Asignación de Líder ECU a un curso entero.
-- Espejo de TeacherSubjectAssignment pero a nivel Course (todas las asignaturas).
-- Multi-tenant via User.institutionId (no se duplica en esta tabla).
-- Creada por un ECU_MASTER desde /admin/leader-assignments (ago 2026).
CREATE TABLE "LeaderCourseAssignment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaderCourseAssignment_pkey" PRIMARY KEY ("id")
);

-- Un mismo líder no puede tener el mismo curso dos veces.
CREATE UNIQUE INDEX "LeaderCourseAssignment_userId_courseId_key"
    ON "LeaderCourseAssignment"("userId", "courseId");

-- Lookups por usuario (panel del líder: "mis cursos") y por curso
-- (filtro inverso: "¿quiénes lideran este curso?").
CREATE INDEX "LeaderCourseAssignment_userId_idx"
    ON "LeaderCourseAssignment"("userId");

CREATE INDEX "LeaderCourseAssignment_courseId_idx"
    ON "LeaderCourseAssignment"("courseId");

-- FKs con CASCADE para que borrar el User o el Course limpie la asignación.
ALTER TABLE "LeaderCourseAssignment"
    ADD CONSTRAINT "LeaderCourseAssignment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeaderCourseAssignment"
    ADD CONSTRAINT "LeaderCourseAssignment_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;