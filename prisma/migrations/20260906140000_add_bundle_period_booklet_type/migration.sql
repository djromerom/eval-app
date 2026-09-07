-- Sprint Bundle-Period (sep 2026): agrega Period y BookletType opcional
-- al compendio (EvaluationBundle). Sin backfill — los bundles existentes
-- quedan con NULL y se editan desde /admin/bundles/[id]/edit-form
-- (decisión del docente, 6 sep 2026).

-- AlterTable
ALTER TABLE "EvaluationBundle" ADD COLUMN "periodId" UUID;
ALTER TABLE "EvaluationBundle" ADD COLUMN "bookletTypeId" UUID;

-- CreateIndex
CREATE INDEX "EvaluationBundle_institutionId_periodId_idx" ON "EvaluationBundle"("institutionId", "periodId");

-- AddForeignKey
ALTER TABLE "EvaluationBundle" ADD CONSTRAINT "EvaluationBundle_periodId_fkey"
    FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationBundle" ADD CONSTRAINT "EvaluationBundle_bookletTypeId_fkey"
    FOREIGN KEY ("bookletTypeId") REFERENCES "BookletType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
