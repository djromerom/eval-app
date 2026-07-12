import { Worker } from "bullmq";
import {
  QUEUE_NAMES,
  getRedisConnection,
  type OmrScanJob,
} from "@/shared/infrastructure/queue/queues";
import { logger } from "@/shared/infrastructure/logger";

/**
 * Worker de calificación OMR (REQUERIMIENTOS_v2.md §3.6).
 * Proceso independiente (PM2): consume la cola `omr-scan` y por cada hoja
 * ejecuta QR → alineación → detección de burbujas → calificación.
 *
 * Placeholder de la Fase 3: aquí se cablearán preprocessScan/measureFillRatio
 * (readQuestion del dominio) y la persistencia de StudentAnswer + score.
 * Si la precisión cae por debajo del 95 %, recién ahí se evalúa el
 * microservicio Python/OpenCV — no antes.
 */
const log = logger.child({ worker: "omr" });

const worker = new Worker<OmrScanJob>(
  QUEUE_NAMES.omrScan,
  async (job) => {
    log.info({ jobId: job.id, ...job.data }, "Procesando hoja de respuestas");
    // TODO Fase 3: preprocessScan(imagen) → detectar QR → verificar HMAC →
    // medir fillRatio por burbuja → readQuestion → calcular score → guardar.
    return { answerSheetId: job.data.answerSheetId, status: "PENDING" as const };
  },
  { connection: getRedisConnection(), concurrency: 2 },
);

worker.on("completed", (job) => log.info({ jobId: job.id }, "Hoja procesada"));
worker.on("failed", (job, err) => log.error({ jobId: job?.id, err }, "Fallo al procesar hoja"));

log.info("Worker OMR iniciado, esperando trabajos…");

async function shutdown() {
  log.info("Cerrando worker OMR…");
  await worker.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
