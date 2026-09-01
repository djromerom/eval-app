-- AlterTable
-- Override del layout de impresión por sección: "auto" (heurística), "1col"
-- (forzar 1 columna) o "2col" (forzar 2 columnas). Nullable: NULL = "auto",
-- comportamiento idéntico a antes del sprint de baja densidad.
ALTER TABLE "EvaluationSection" ADD COLUMN "columnLayoutOverride" TEXT;