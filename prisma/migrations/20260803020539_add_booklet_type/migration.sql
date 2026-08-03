-- AlterTable
ALTER TABLE "Evaluation" ADD COLUMN     "bookletTypeId" UUID;

-- CreateTable
CREATE TABLE "BookletType" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "periodId" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookletType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookletType_institutionId_periodId_idx" ON "BookletType"("institutionId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "BookletType_institutionId_periodId_name_key" ON "BookletType"("institutionId", "periodId", "name");

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_bookletTypeId_fkey" FOREIGN KEY ("bookletTypeId") REFERENCES "BookletType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookletType" ADD CONSTRAINT "BookletType_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookletType" ADD CONSTRAINT "BookletType_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
