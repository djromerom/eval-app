-- Migración: 4ª vista de portada — Cover HTML (componente <HtmlLiveEditor>).
-- ======================================================================
--
-- Columnas nuevas en `EvaluationBundle`, paralelas a `coverTemplateBody`
-- (HTML override de Monaco) y `coverVisualProject` (proyecto GrapesJS):
--
--   • `coverLiveProject`  (JSONB) — `{ html: string, previewMode?: boolean }`.
--     Es el HTML editable que el docente manipula en
--     `/admin/bundles/[id]/cover-html` (iframe sandbox + contenteditable).
--
--   • `coverLiveUpdatedAt` (TIMESTAMP(3)) — última vez que se guardó.
--     `null` si nunca se editó (cae al visual / HTML / built-in).
--
-- Si está set, GANA sobre `coverVisualProject` y `coverTemplateBody` en el
-- render del cover (precedencia: live → visual → HTML → built-in).
--
-- Migración ADITIVA — no toca columnas existentes. Las 4 vistas conviven
-- (cover-designer / cover-studio / cover-visual / cover-html). El render
-- actual de `preview-cover.ts` se extenderá para preferir coverLiveProject
-- cuando exista (PR de Cover HTML).
ALTER TABLE "EvaluationBundle"
  ADD COLUMN "coverLiveProject"   JSONB,
  ADD COLUMN "coverLiveUpdatedAt" TIMESTAMP(3);