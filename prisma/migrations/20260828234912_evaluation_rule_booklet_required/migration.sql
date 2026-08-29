/*
  Warnings:

  - Made the column `bookletTypeId` on table `EvaluationRule` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "EvaluationRule" DROP CONSTRAINT "EvaluationRule_bookletTypeId_fkey";

-- AlterTable
ALTER TABLE "EvaluationRule" ALTER COLUMN "bookletTypeId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "EvaluationRule" ADD CONSTRAINT "EvaluationRule_bookletTypeId_fkey" FOREIGN KEY ("bookletTypeId") REFERENCES "BookletType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
