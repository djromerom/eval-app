import { prisma } from "@/shared/infrastructure/db/prisma";
import { env } from "@/config/env";
import { PrismaEvaluationRepository } from "@/modules/evaluations/infrastructure/prisma-evaluation-repository";
import { PrismaDisabledBundleQuestionRepository } from "@/modules/bundles/infrastructure/prisma-disabled-bundle-question-repository";
import type { AnswerKey } from "@/modules/evaluations/domain/evaluation";
import { PrismaScanningRepository } from "./prisma-scanning-repository";
import { sharpQrDecoder } from "./qr-decoder";
import { OmrServiceQrDecoder, chainQrDecoders } from "./omr-service-qr-decoder";
import { HttpOmrDetector } from "./http-omr-detector";
import {
  PrismaUnclassifiedScanRepository,
  bullOmrJobQueue,
} from "./prisma-unclassified-scan-repository";
import {
  ProcessAnswerSheet,
  type EvaluationQuestionsProvider,
} from "../application/process-answer-sheet";
import { ClassifyUnclassifiedScan } from "../application/classify-unclassified-scan";
import { CorrectAnswerSheetAnswers } from "../application/correct-answer-sheet-answers";
import { PrismaStudentAnswersReader } from "./prisma-scanning-repository";

const scanningRepo = new PrismaScanningRepository();
const evaluationRepo = new PrismaEvaluationRepository();
const disabledQuestionsRepo = new PrismaDisabledBundleQuestionRepository();

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
   *  por (student × item) sin reconsultas.
   *  `disabled` marca las preguntas inhabilitadas del cuadernillo, que
   *  ProcessAnswerSheet excluye de la nota. */
  async getCorrectAnswersForBundle(institutionId: string, bundleId: string) {
    const disabledRows = await disabledQuestionsRepo.listActiveByBundle(bundleId);
    const disabledIds = new Set(disabledRows.map((r) => r.questionId));
    const items = await prisma.evaluationBundleItem.findMany({
      where: { bundleId, bundle: { institutionId } },
      orderBy: { order: "asc" },
      include: {
        evaluation: {
          include: {
            sections: {
              orderBy: { order: "asc" },
              include: {
                questions: {
                  orderBy: { number: "asc" },
                  include: { options: { orderBy: { key: "asc" } } },
                },
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
      disabled: boolean;
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
            disabled: disabledIds.has(q.id),
          });
        }
      }
    }
    return out;
  },
};

export const makeProcessAnswerSheet = () =>
  new ProcessAnswerSheet(
    scanningRepo,
    // QR: primero el decoder local (sin red, y aporta finder patterns); si no
    // lee el escaneo, cae al decodificador WeChat del omr-service.
    chainQrDecoders(sharpQrDecoder, new OmrServiceQrDecoder(env.OMR_SERVICE_URL)),
    questionsProvider,
    // Detección delegada al microservicio Python (omr-service) por HTTP.
    new HttpOmrDetector(env.OMR_SERVICE_URL),
  );

export const makeClassifyUnclassifiedScan = () =>
  new ClassifyUnclassifiedScan(new PrismaUnclassifiedScanRepository(), bullOmrJobQueue);

export const makeCorrectAnswerSheetAnswers = () =>
  new CorrectAnswerSheetAnswers(
    scanningRepo,
    new PrismaStudentAnswersReader(),
    questionsProvider,
  );
