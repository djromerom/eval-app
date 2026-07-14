/*
  Warnings:

  - You are about to drop the column `colors` on the `Institution` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Evaluation" ADD COLUMN     "theme" JSONB;

-- AlterTable
ALTER TABLE "Institution" DROP COLUMN "colors",
ADD COLUMN     "theme" JSONB;
