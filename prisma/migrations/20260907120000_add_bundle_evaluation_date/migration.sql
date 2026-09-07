-- Agrega `evaluationDate` opcional al `EvaluationBundle` para que el admin
-- pueda registrar la fecha de aplicación de la prueba. Cuando está set, se
-- imprime en la hoja de respuestas unificada del cuadernillo
-- (`/print/answer-sheets/bundle/[id]`); cuando es null, el bloque "Fecha:"
-- no se renderiza en absoluto (ni siquiera con la línea en blanco).
--
-- Nullable para compat con bundles existentes en prod.
ALTER TABLE "EvaluationBundle" ADD COLUMN "evaluationDate" TIMESTAMP(3);
