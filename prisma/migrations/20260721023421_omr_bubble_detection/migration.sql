-- AlterTable
ALTER TABLE "AnswerSheet" ADD COLUMN     "detectionConfidence" DOUBLE PRECISION,
ADD COLUMN     "gridLayout" JSONB;

-- AlterTable
ALTER TABLE "StudentAnswer" ADD COLUMN     "cells" JSONB,
ADD COLUMN     "fillRatio" DOUBLE PRECISION;
