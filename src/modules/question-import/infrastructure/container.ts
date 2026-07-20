import { PrismaEvaluationRepository } from "@/modules/evaluations/infrastructure/prisma-evaluation-repository";
import { PrismaBankQuestionRepository } from "@/modules/question-bank/infrastructure/prisma-bank-repository";
import { ImportQuestions } from "../application/import-questions";
import { QuestionsFromEvaluation } from "../application/questions-from-evaluation";

/** Composition root del módulo de importación de preguntas. */
const evaluations = new PrismaEvaluationRepository();
const bank = new PrismaBankQuestionRepository();

export const makeImportQuestions = () => new ImportQuestions(evaluations, bank);
export const makeQuestionsFromEvaluation = () => new QuestionsFromEvaluation(evaluations);
