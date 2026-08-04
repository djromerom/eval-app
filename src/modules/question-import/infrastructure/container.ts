import { PrismaEvaluationRepository } from "@/modules/evaluations/infrastructure/prisma-evaluation-repository";
import { PrismaBankQuestionRepository } from "@/modules/question-bank/infrastructure/prisma-bank-repository";
import { ImportQuestions } from "../application/import-questions";
import { QuestionsFromEvaluation } from "../application/questions-from-evaluation";
import { EnqueueQuestionImport } from "../application/enqueue-question-import";
import { PrismaQuestionImportJobRepository } from "./PrismaQuestionImportJobRepository";
import type { QuestionImportJobRepository } from "../domain/question-import-job";
import { runQuestionExtract } from "./question-extract-handler";

/**
 * Composition root del módulo de importación de preguntas. Centraliza la
 * construcción de use cases y repositorios para que el resto del codebase
 * (server actions, API routes, workers) solo importe factories — nunca
 * instancias con `new` directo.
 *
 * El `PrismaQuestionImportJobRepository` reusa el cliente Prisma global
 * (`@/shared/infrastructure/db/prisma`); en tests se sustituye con un
 * fake in-memory vía las factories `make*WithRepo(...)` que reciben el repo.
 */
const evaluations = new PrismaEvaluationRepository();
const bank = new PrismaBankQuestionRepository();

/** Repo de `QuestionImportJob` (persistencia del estado de extracción IA). */
export function makeQuestionImportJobRepo(): QuestionImportJobRepository {
  return new PrismaQuestionImportJobRepository();
}

/**
 * Use case para encolar una nueva importación IA. El worker resuelve
 * `payload.jobId` desde la BD; no es necesario pasar la fila entera en
 * Redis (el payload sólo carga punteros + identificadores).
 */
export function makeEnqueueQuestionImport(): EnqueueQuestionImport {
  return new EnqueueQuestionImport(makeQuestionImportJobRepo());
}

/**
 * Handler puro de la extracción. NO depende de BullMQ: la cola solo lo
 * adapta como `new Worker(... ,async (job) => runQuestionExtract(job.data, { repo }))`.
 * Al sacarlo de BullMQ los tests unitarios pueden llamarlo con un repo fake.
 */
export function makeQuestionExtractHandler() {
  return (payload: Parameters<typeof runQuestionExtract>[0]) =>
    runQuestionExtract(payload, { repo: makeQuestionImportJobRepo() });
}

export const makeImportQuestions = () => new ImportQuestions(evaluations, bank);
export const makeQuestionsFromEvaluation = () => new QuestionsFromEvaluation(evaluations);
