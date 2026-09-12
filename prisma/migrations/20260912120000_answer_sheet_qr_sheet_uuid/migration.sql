-- Identificador del PAPEL (campo `sheet` del QR), con indice unico.
--
-- Sin esto, pasar la misma hoja dos veces por el alimentador crea dos
-- AnswerSheet y dos calificaciones para el mismo estudiante, sin ninguna
-- señal. En los datos de prueba habia 12 hojas validadas con solo 5 QR
-- distintos, una de ellas escaneada 6 veces.
--
-- Nullable porque las hojas ya cargadas no tienen el dato y no se puede
-- reconstruir sin reprocesarlas; el indice unico de Postgres ignora los NULL,
-- asi que conviven sin chocar entre si.
ALTER TABLE "AnswerSheet" ADD COLUMN "qrSheetUuid" TEXT;
CREATE UNIQUE INDEX "AnswerSheet_qrSheetUuid_key" ON "AnswerSheet"("qrSheetUuid");
