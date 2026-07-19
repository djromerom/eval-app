-- ============================================================================
-- Sprint 7: duración estimada por evaluación (Sprint 7 cubre el tiempo POR
-- evaluación en la portada del compendio; antes se calculaba como
-- totalQuestions * DEFAULT_MINUTES_PER_QUESTION).
--
-- Nullable → la migración es aditiva: las evaluations existentes quedan con
-- NULL y la portada del compendio cae al cálculo heurístico para ellas hasta
-- que el docente EDITA la evaluation y setea el tiempo en el panel Settings.
-- Ver docs/compendios.md §"Sprint 7".
-- ============================================================================

ALTER TABLE "Evaluation"
  ADD COLUMN "durationMinutes" INTEGER;
