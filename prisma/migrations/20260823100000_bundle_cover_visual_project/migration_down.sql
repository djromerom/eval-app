-- Rollback simétrico de la migración "bundle_cover_visual_project".
-- Solo se usa si PR 1 (SPIKE) se descarta antes de mergear. NUNCA correr
-- en producción una vez que algún bundle tenga coverVisualProject != null
-- (perderíamos datos). Idempotente: `IF EXISTS` evita error si las
-- columnas ya no están.

ALTER TABLE "EvaluationBundle"
  DROP COLUMN IF EXISTS "coverVisualProject",
  DROP COLUMN IF EXISTS "coverVisualUpdatedAt";
