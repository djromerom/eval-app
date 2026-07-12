import { Worker } from "bullmq";
import {
  QUEUE_NAMES,
  getRedisConnection,
  type PdfGenerationJob,
} from "@/shared/infrastructure/queue/queues";
import { logger } from "@/shared/infrastructure/logger";

/**
 * Worker de generación de PDF server-side (REQUERIMIENTOS_v2.md §8).
 * Método SECUNDARIO: el primario es imprimir desde el navegador (/print/*).
 * Este worker existe para la descarga masiva de cartillas/hojas de respuesta.
 *
 * Placeholder de la Fase 2/3: aquí se lanzará Puppeteer + @sparticuz/chromium
 * apuntando a la ruta /print/evaluation/[id] y se guardará el PDF en STORAGE_DIR.
 */
const log = logger.child({ worker: "pdf" });

const worker = new Worker<PdfGenerationJob>(
  QUEUE_NAMES.pdfGeneration,
  async (job) => {
    log.info({ jobId: job.id, ...job.data }, "Generando PDF");
    // TODO Fase 2/3: Puppeteer.launch → page.goto(/print/evaluation/{id}) →
    // page.pdf({ format: 'Tabloid', landscape: true }) → guardar en STORAGE_DIR.
    return { evaluationId: job.data.evaluationId, kind: job.data.kind, path: null };
  },
  { connection: getRedisConnection(), concurrency: 1 },
);

worker.on("completed", (job) => log.info({ jobId: job.id }, "PDF generado"));
worker.on("failed", (job, err) => log.error({ jobId: job?.id, err }, "Fallo al generar PDF"));

log.info("Worker PDF iniciado, esperando trabajos…");

async function shutdown() {
  log.info("Cerrando worker PDF…");
  await worker.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
