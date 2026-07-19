import { prisma } from "@/shared/infrastructure/db/prisma";
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
        optionsLength: q.options.length,
      })),
    );
  },

  /** Une, en orden de item, todas las questions de cada evaluation del bundle.
   *  `number` se reescribe a la posición global 1..N.
   *  `bundleItemId` (Sprint 4) habilita el drill-down del reporte comparativo
   *  por (student × item) sin reconsultas. */
  async getCorrectAnswersForBundle(institutionId: string, bundleId: string) {
    const items = await prisma.evaluationBundleItem.findMany({
      where: { bundleId, bundle: { institutionId } },
      orderBy: { order: "asc" },
      include: {
        evaluation: {
          include: {
            sections: {
              orderBy: { order: "asc" },
              include: {
                questions: { orderBy: { number: "asc" }, include: { options: true } },
              },
            },
          },
        },
      },
    });
    const out: {
      id: string;
      number: number;
      bundleItemId: string;
      correctAnswer: AnswerKey;
      optionsLength: number;
    }[] = [];
    let global = 1;
    for (const item of items) {
      for (const section of item.evaluation.sections) {
        for (const q of section.questions) {
          out.push({
            id: q.id,
            number: global++,
            bundleItemId: item.id,
            correctAnswer: q.correctAnswer as AnswerKey,
            optionsLength: q.options.length,
          });
        }
      }
    }
    return out;
  },
};

export const makeProcessAnswerSheet = () =>
  new ProcessAnswerSheet(scanningRepo, sharpQrDecoder, questionsProvider);
