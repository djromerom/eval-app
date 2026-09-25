-- Hojas sin clasificar de la carga automática (sep 2026).
--
-- En modo Automático, las hojas cuyo QR no permite saber el cuadernillo
-- (ilegible, firma inválida, cuadernillo no LISTO...) no reciben AnswerSheet:
-- la invariante XOR de AnswerSheet exige un cuadernillo o una formulación.
-- El archivo ya se guardaba en scans/<primer lote>/sin-clasificar/, pero nada
-- en la base lo recordaba. Esta tabla lo registra para que el lote muestre
-- esas hojas y alguien les asigne cuadernillo y estudiante a mano.
--
--   - scanBatchId: el primer lote de la carga (donde vive la carpeta). Cascada:
--     si se borra el lote, se van sus hojas sin clasificar.
--   - answerSheetId: la hoja creada al clasificarla. Su presencia es lo que le
--     dice al worker que la hoja se identificó a mano y no debe leer el QR.
--   - reason: código de MotivoSinClasificar, no el texto.

-- CreateTable
CREATE TABLE "UnclassifiedScan" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "scanBatchId" UUID NOT NULL,
    "filePath" TEXT NOT NULL,
    "originalFilename" TEXT,
    "reason" TEXT NOT NULL,
    "uploadedBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" UUID,
    "answerSheetId" UUID,

    CONSTRAINT "UnclassifiedScan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UnclassifiedScan_answerSheetId_key" ON "UnclassifiedScan"("answerSheetId");

-- CreateIndex
CREATE INDEX "UnclassifiedScan_scanBatchId_idx" ON "UnclassifiedScan"("scanBatchId");

-- CreateIndex
CREATE INDEX "UnclassifiedScan_institutionId_idx" ON "UnclassifiedScan"("institutionId");

-- AddForeignKey
ALTER TABLE "UnclassifiedScan" ADD CONSTRAINT "UnclassifiedScan_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnclassifiedScan" ADD CONSTRAINT "UnclassifiedScan_scanBatchId_fkey" FOREIGN KEY ("scanBatchId") REFERENCES "ScanBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnclassifiedScan" ADD CONSTRAINT "UnclassifiedScan_answerSheetId_fkey" FOREIGN KEY ("answerSheetId") REFERENCES "AnswerSheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-Level Security: mismo patrón que ScanBatch (20260712195900_enable_rls).
-- Sin FORCE: el rol dueño que usa la app hoy omite RLS y filtra por
-- institutionId en la capa de aplicación; el rol restringido eval_app sí
-- aplica la política.
ALTER TABLE "UnclassifiedScan" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "UnclassifiedScan"
  USING ("institutionId" = current_setting('app.current_institution', true)::uuid)
  WITH CHECK ("institutionId" = current_setting('app.current_institution', true)::uuid);
