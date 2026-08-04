import "./load-env";
import { Worker } from "bullmq";
import {
  QUEUE_NAMES,
  getBullMQPrefix,
  getRedisConnection,
  type QuestionExtractResult,
} from "@/shared/infrastructure/queue/queues";
import { logger } from "@/shared/infrastructure/logger";
import { makeQuestionExtractHandler } from "@/modules/question-import/infrastructure/container";
import type { QuestionExtractJob } from "@/modules/question-import/domain/question-import-queue";

/**
 * Worker de extracción IA de preguntas (REQUERIMIENTOS_v2.md §3.6 +
 * plan de import IA con saber-extractor).
 *
 * Procesa los jobs encolados por `EnqueueQuestionImport` desde la pestaña
 * "Importar con IA" del wizard. El flujo general es:
 *   1. Server action sube el PDF al storage institucional y crea
 *      `QuestionImportJob{status: QUEUED}` + encola este job.
 *   2. Este worker toma el job, lee el PDF, ejecuta `saber-extractor`
 *      (2-pass: extract + solve) extrayendo imágenes y persistiendo el
 *      resultado en `QuestionImportJob.resultJson` / `warningsJson`.
 *   3. El endpoint SSE `/api/import/{jobId}/stream` emite progreso y
 *      resultado a la UI, que abre `ImportReviewForm` con el badge de
 *      confianza por respuesta.
 *
 * La concurrency=2 replica el patrón de `omr.worker.ts`: suficiente para
 * absorber picos de varios docentes subiendo a la vez sin saturar la
 * única instancia Next del VPS. Si en el futuro se quiere escalar, basta
 * con levantar más réplicas de este mismo proceso (BullMQ reparte solo).
 *
 * Manejo de errores:
 *   - Si `runQuestionExtract` lanza (PDF ilegible, modelo caído), el handler
 *     ya marcó `status=FAILED, errorMessage` antes de propagar. BullMQ
 *     reintentará según `defaultJobOptions` del queue (attempts: 2, 30s
 *     backoff). Tras agotar intentos, el SSE emite `error` con el último
 *     mensaje.
 */
const log = logger.child({ worker: "question-extract" });

const handleJob = makeQuestionExtractHandler();

const worker = new Worker<QuestionExtractJob, QuestionExtractResult>(
  QUEUE_NAMES.questionExtract,
  async (job) => {
    const { jobId, institutionId } = job.data;
    log.info({ jobId, institutionId }, "Iniciando extracción IA de preguntas");

    const result = await handleJob(job.data);

    log.info(
      {
        jobId,
        questionsCount: result.questionsCount,
        warningsCount: result.warningsCount,
      },
      "Extracción IA completada",
    );

    return {
      jobId,
      status: "DONE" as const,
      questionsCount: result.questionsCount,
      warningsCount: result.warningsCount,
    };
  },
  { connection: getRedisConnection(), prefix: getBullMQPrefix(), concurrency: 2 },
);

worker.on("completed", (job, ret) =>
  log.info({ jobId: job.id, returnvalue: ret }, "Job de extracción completado"),
);
worker.on("failed", (job, err) =>
  log.error({ jobId: job?.id, err: err.message }, "Job de extracción falló"),
);

log.info("Worker question-extract iniciado, esperando trabajos…");

async function shutdown() {
  log.info("Cerrando worker question-extract…");
  await worker.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
