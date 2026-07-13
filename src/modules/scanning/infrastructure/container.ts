import { PrismaEvaluationRepository } from "@/modules/evaluations/infrastructure/prisma-evaluation-repository";
import type { AnswerKey } from "@/modules/evaluations/domain/evaluation";
import { PrismaScanningRepository } from "./prisma-scanning-repository";
import { sharpQrDecoder } from "./qr-decoder";
import {
  ProcessAnswerSheet,
  type EvaluationQuestionsProvider,
} from "../application/process-answer-sheet";

const scanningRepo = new PrismaScanningRepository();
const evaluationRepo = new PrismaEvaluationRepository();

const questionsProvider: EvaluationQuestionsProvider = {
  async getCorrectAnswers(institutionId: string, evaluationId: string) {
    const detail = await evaluationRepo.getDetail(institutionId, evaluationId);
    if (!detail) return [];
    return detail.sections.flatMap((s) =>
      s.questions.map((q) => ({
        id: q.id,
        number: q.number,
        correctAnswer: q.correctAnswer as AnswerKey,
      })),
    );
  },
};

export const makeProcessAnswerSheet = () =>
  new ProcessAnswerSheet(scanningRepo, sharpQrDecoder, questionsProvider);
