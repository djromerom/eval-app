-- Drop cover-visual (3ª vista de portada, ago 2026).
-- ============================================
--
-- La vista /admin/bundles/[id]/cover-visual con editor GrapesJS se quitó
-- (ago 2026) — nunca pasó de PR 4 y 0 bundles la usaban en producción.
-- Las columnas coverVisualProject / coverVisualUpdatedAt se dropean
-- porque ya no hay código que las lea ni las escriba.
--
-- No hace falta `migration_down.sql`: la migración
-- 20260823100000_bundle_cover_visual_project (que las añadió) sigue en
-- el repo y se puede reaplicar manualmente si alguien necesitara
-- revertir el feature. Prisma migrations son append-only.

ALTER TABLE "EvaluationBundle"
  DROP COLUMN IF EXISTS "coverVisualUpdatedAt",
  DROP COLUMN IF EXISTS "coverVisualProject";