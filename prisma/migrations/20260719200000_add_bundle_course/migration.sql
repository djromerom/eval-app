-- Sprint 9: curso opcional por compendio.
-- null = compendio cross-course (simulacro institucional multi-grado).
-- Si está definido, todos los items deben ser evaluations de ese curso
-- (invariante validada en los use cases, no en la DB).

-- AlterTable
ALTER TABLE "EvaluationBundle" ADD COLUMN "courseId" UUID;

-- AddForeignKey
-- SET NULL: si se borra el curso, el compendio sobrevive como cross-course
-- (las hojas escaneadas apuntan al bundle, no al curso).
ALTER TABLE "EvaluationBundle" ADD CONSTRAINT "EvaluationBundle_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "EvaluationBundle_institutionId_courseId_idx" ON "EvaluationBundle"("institutionId", "courseId");
