-- La FK questionId de DisabledBundleQuestion era ON DELETE RESTRICT: borrar una
-- pregunta (o la sección/contexto que la contiene) que alguna vez se inhabilitó
-- en un cuadernillo fallaba con un error sin manejar. Una inhabilitación sin
-- pregunta no significa nada, así que se borra con ella. Si el cuadernillo ya
-- tiene hojas calificadas, StudentAnswer_questionId_fkey (RESTRICT) sigue
-- impidiendo borrar la pregunta.
ALTER TABLE "DisabledBundleQuestion" DROP CONSTRAINT "DisabledBundleQuestion_questionId_fkey";

ALTER TABLE "DisabledBundleQuestion"
  ADD CONSTRAINT "DisabledBundleQuestion_questionId_fkey"
  FOREIGN KEY ("questionId") REFERENCES "Question"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
