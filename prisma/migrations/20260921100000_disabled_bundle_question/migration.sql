-- Sprint Preguntas inhabitadas del Cuadernillo (sep 2026).
--
-- Tabla para que el docente marque preguntas individuales de un Cuadernillo
-- que NO cuentan para la calificación (clave mal impresa, pregunta retirada
-- post-print, redacción ambigua). Por pregunta individual — no por
-- `EvaluationBundleItem` entero — porque las preguntas dentro de una
-- evaluation siguen contando.
--
-- Decisiones deliberadas (ver prisma/schema.prisma y MEMORY.md):
--   - Re-habilitar NO borra la fila: baja `disabled` a false. Conserva la
--     auditoría de "esta pregunta fue inhabitada en algún momento".
--   - Lock pre-scan en use case (no a nivel DB): toggling se bloquea cuando
--     ya existe un ScanBatch apuntando al bundle. Aquí no se enforce nada
--     para no confundir constraints DB con reglas de flujo.
--   - Cascada desde bundle: si se borra el bundle, se van las inhabitaciones.
--     Razonamiento: una pregunta inhabitada fuera de su bundle no tiene
--     significado; dejarla huérfana invita a FKs fantasma en queries futuros.
--
CREATE TABLE "DisabledBundleQuestion" (
    "id" UUID NOT NULL,
    "bundleId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "disabledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledByUserId" UUID NOT NULL,
    "disabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DisabledBundleQuestion_pkey" PRIMARY KEY ("id")
);

-- Unicidad: una fila activa por (bundle, pregunta). Cuando se re-habilita, se
-- baja `disabled` a false, no se inserta otra fila — así @@unique no choca
-- con la historia previa.
CREATE UNIQUE INDEX "DisabledBundleQuestion_bundleId_questionId_key"
  ON "DisabledBundleQuestion"("bundleId", "questionId");

-- Index por bundleId para el helper `preguntasEfectivas`:
--   SELECT questionId FROM DisabledBundleQuestion WHERE bundleId = $1
CREATE INDEX "DisabledBundleQuestion_bundleId_idx"
  ON "DisabledBundleQuestion"("bundleId");

ALTER TABLE "DisabledBundleQuestion"
  ADD CONSTRAINT "DisabledBundleQuestion_bundleId_fkey"
  FOREIGN KEY ("bundleId") REFERENCES "EvaluationBundle"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DisabledBundleQuestion"
  ADD CONSTRAINT "DisabledBundleQuestion_questionId_fkey"
  FOREIGN KEY ("questionId") REFERENCES "Question"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DisabledBundleQuestion"
  ADD CONSTRAINT "DisabledBundleQuestion_disabledByUserId_fkey"
  FOREIGN KEY ("disabledByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
