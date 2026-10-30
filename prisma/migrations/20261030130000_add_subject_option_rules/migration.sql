-- Reglas de OPCIONES DE RESPUESTA por (Prueba × Asignatura) (oct 2026).
--
-- Qué resuelve: hasta ahora el número de opciones por pregunta era global
-- (`.env`: EVAL_DEFAULT_OPTIONS / EVAL_MAX_OPTIONS) y el mínimo real era 2.
-- Ahora el default es ESTRICTO: exactamente 4 opciones por pregunta.
--
-- Para las asignaturas que necesiten otra cosa, el admin crea una regla por
-- (Prueba × Asignatura) con un mínimo y un máximo configurables (2..8). El
-- techo de 8 no es arbitrario: la hoja de respuestas siempre imprime 8
-- columnas fijas (A–H) y el OMR escanea 8.
--
-- Sin regla → default estricto (exactamente 4). La unicidad
-- (institutionId, periodId, subjectId) garantiza una sola regla por
-- combinación.

-- CreateTable
CREATE TABLE "SubjectOptionRule" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "minOptions" INTEGER NOT NULL,
    "maxOptions" INTEGER NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubjectOptionRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubjectOptionRule_institutionId_periodId_idx" ON "SubjectOptionRule"("institutionId", "periodId");

-- CreateIndex
CREATE INDEX "SubjectOptionRule_institutionId_subjectId_idx" ON "SubjectOptionRule"("institutionId", "subjectId");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "SubjectOptionRule_institutionId_periodId_subjectId_key" ON "SubjectOptionRule"("institutionId", "periodId", "subjectId");

-- AddForeignKey
ALTER TABLE "SubjectOptionRule" ADD CONSTRAINT "SubjectOptionRule_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SubjectOptionRule" ADD CONSTRAINT "SubjectOptionRule_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SubjectOptionRule" ADD CONSTRAINT "SubjectOptionRule_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SubjectOptionRule" ADD CONSTRAINT "SubjectOptionRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
