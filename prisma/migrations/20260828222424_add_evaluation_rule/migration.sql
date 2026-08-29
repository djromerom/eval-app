-- AlterTable
ALTER TABLE "EvaluationBundle" ALTER COLUMN "coverTemplateKey" SET DATA TYPE TEXT;

-- CreateTable
CREATE TABLE "EvaluationRule" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "bookletTypeId" UUID,
    "exactQuestions" INTEGER NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvaluationRule_institutionId_periodId_idx" ON "EvaluationRule"("institutionId", "periodId");

-- CreateIndex
CREATE INDEX "EvaluationRule_institutionId_periodId_courseId_subjectId_idx" ON "EvaluationRule"("institutionId", "periodId", "courseId", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationRule_institutionId_periodId_courseId_subjectId_bo_key" ON "EvaluationRule"("institutionId", "periodId", "courseId", "subjectId", "bookletTypeId");

-- AddForeignKey
ALTER TABLE "EvaluationRule" ADD CONSTRAINT "EvaluationRule_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationRule" ADD CONSTRAINT "EvaluationRule_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationRule" ADD CONSTRAINT "EvaluationRule_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationRule" ADD CONSTRAINT "EvaluationRule_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationRule" ADD CONSTRAINT "EvaluationRule_bookletTypeId_fkey" FOREIGN KEY ("bookletTypeId") REFERENCES "BookletType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationRule" ADD CONSTRAINT "EvaluationRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
