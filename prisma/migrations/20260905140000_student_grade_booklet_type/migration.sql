-- Pedido del docente (5 sep 2026): agregar dos columnas nuevas a Student.
-- - `grade`: grado del estudiante como texto libre ("11", "2", etc.). NO es FK
--   porque el course ya está implícito en `group.courseId` y los reportes
--   institucionales suelen querer el grado en formato no normalizado.
-- - `bookletTypeId`: FK opcional a BookletType. El docente lo usa para
--   asignar el cuadernillo por defecto del estudiante al armar hojas de
--   respuesta. Nullable para mantener compat con filas existentes.
--
-- Las 2 columnas son NULLABLE sin default: las filas existentes quedan null
-- y el docente las rellena vía import XLSX o edición individual.

ALTER TABLE "Student"
  ADD COLUMN "grade"         TEXT,
  ADD COLUMN "bookletTypeId" TEXT;

ALTER TABLE "Student"
  ADD CONSTRAINT "Student_bookletTypeId_fkey"
  FOREIGN KEY ("bookletTypeId") REFERENCES "BookletType"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Student_bookletTypeId_idx" ON "Student"("bookletTypeId");
