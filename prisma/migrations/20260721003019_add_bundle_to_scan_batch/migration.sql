-- AlterTable
ALTER TABLE "ScanBatch" ADD COLUMN     "bundleId" UUID;

-- CreateIndex
CREATE INDEX "ScanBatch_bundleId_idx" ON "ScanBatch"("bundleId");

-- AddForeignKey
ALTER TABLE "ScanBatch" ADD CONSTRAINT "ScanBatch_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "EvaluationBundle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
