-- CreateTable
CREATE TABLE "QuestionImportJob" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "uploadedById" UUID NOT NULL,
    "evaluationId" UUID,
    "status" TEXT NOT NULL,
    "pdfRelativePath" TEXT NOT NULL,
    "resultJson" JSONB,
    "warningsJson" JSONB,
    "errorMessage" TEXT,
    "bullJobId" TEXT,
    "progressPhase" TEXT,
    "progressDone" INTEGER,
    "progressOf" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuestionImportJob_bullJobId_key" ON "QuestionImportJob"("bullJobId");

-- CreateIndex
CREATE INDEX "QuestionImportJob_institutionId_uploadedById_idx" ON "QuestionImportJob"("institutionId", "uploadedById");

-- CreateIndex
CREATE INDEX "QuestionImportJob_status_idx" ON "QuestionImportJob"("status");

-- CreateIndex
CREATE INDEX "QuestionImportJob_createdAt_idx" ON "QuestionImportJob"("createdAt");
