-- Sprint "cover-designer" — plantilla de portada del cuadernillo (ago 2026).
--
-- Hasta ahora la portada del PDF se generaba con un layout hardcoded dentro de
-- pdf.worker.ts. Este sprint introduce un sistema de plantillas HTML
-- versionadas (ej. "secundaria-v1", "primaria-v1") que viven en
-- eval-app/templates/cover/{key}.html, con la posibilidad de OVERRIDE por
-- bundle (el admin edita o sube su propia versión).
--
-- Modelo:
--   • coverTemplateKey  — qué variante está seleccionada (ej. "secundaria-v1").
--                         Si null, el bundle cae a la variante por defecto del
--                         sistema (ver DEFAULT_COVER_TEMPLATE_KEY).
--   • coverTemplateBody — HTML con variables Mustache. Si está set, REEMPLAZA
--                         al built-in de la misma key (override). Si null,
--                         se usa el built-in de templates/cover/{key}.html.
--   • coverTemplateUpdatedAt — cuándo se guardó el body (null si nunca se
--                         editó, o si la key apunta al built-in).
--
-- Borrar el body (coverTemplateBody=null) NO borra la key; solo cae al
-- built-in de esa key. Para cambiar de variante: coverTemplateKey.
--
-- El feature flag está en default OFF — solo los bundles que visiten
-- /admin/bundles/[id]/cover-designer se les setea la key (la variante por
-- defecto es "secundaria-v1").

ALTER TABLE "EvaluationBundle"
  ADD COLUMN "coverTemplateKey"      VARCHAR(64),
  ADD COLUMN "coverTemplateBody"     TEXT,
  ADD COLUMN "coverTemplateUpdatedAt" TIMESTAMP(3);