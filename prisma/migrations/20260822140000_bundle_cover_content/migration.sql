-- Sprint "coverContent" — copy overrideable de la portada (ago 2026).
--
-- Hasta ahora el texto de la portada (instrucciones, callout, cómo marcar,
-- bullets, prohibido, legalFooter) vivía hardcoded en
-- src/modules/bundle-cover/application/cover-defaults.ts. Este sprint
-- introduce una capa de overrides institucionales y por-compendio guardados
-- en JSONB, con parseo defensivo campo-por-campo (ver
-- src/modules/bundle-cover/domain/cover-content.ts).
--
-- Modelo:
--   • Institution.coverContent     — overrides institucionales (legalFooter,
--                                    cuerpo del bloque prohibido). Lo configura
--                                    el admin en /admin/theme.
--   • EvaluationBundle.coverContent — overrides por compendio (instrucciones,
--                                    callout, howToMark, bullets). Lo configura
--                                    el lider/docente en
--                                    /admin/bundles/:id/cover-designer.
--
-- En runtime (PR 2) getResolvedCoverContent() colapsa:
--   bundle.coverContent ?? institution.coverContent ?? DEFAULT_*
-- Si NINGÚN nivel define el campo, cae al DEFAULT exportado por
-- ./cover-defaults.ts. Así el PDF sigue saliendo aunque la BD esté vacía.
--
-- No seed update: las instituciones y bundles existentes arrancan con
-- coverContent=null y heredan todos los defaults.

ALTER TABLE "Institution"
  ADD COLUMN "coverContent" JSONB;

ALTER TABLE "EvaluationBundle"
  ADD COLUMN "coverContent" JSONB;