-- DropForeignKey
ALTER TABLE "AnswerSheet" DROP CONSTRAINT "AnswerSheet_evaluationId_fkey";

-- AddForeignKey
ALTER TABLE "AnswerSheet" ADD CONSTRAINT "AnswerSheet_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
