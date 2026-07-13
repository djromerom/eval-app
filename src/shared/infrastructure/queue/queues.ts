import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "@/config/env";

/**
 * Colas BullMQ (ver REQUERIMIENTOS_v2.md §3.6):
 * - omr-scan: procesa cada hoja escaneada (QR → alineación → burbujas → calificación)
 * - pdf-generation: genera PDFs server-side (Puppeteer)
 * Los consumidores viven en workers/ y corren como procesos PM2 aparte.
 */
export const QUEUE_NAMES = {
  omrScan: "omr-scan",
  pdfGeneration: "pdf-generation",
} as const;

export interface OmrScanJob {
  answerSheetId: string;
  scanBatchId: string;
  institutionId: string;
  imagePath: string;
}

export interface PdfGenerationJob {
  evaluationId: string;
  kind: "booklet" | "answer-sheets" | "answer-key";
}

let connection: IORedis | undefined;

export function getRedisConnection(): IORedis {
  // maxRetriesPerRequest: null es requerido por BullMQ
  connection ??= new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return connection;
}

let omrQueue: Queue<OmrScanJob> | undefined;
let pdfQueue: Queue<PdfGenerationJob> | undefined;

export function getOmrScanQueue(): Queue<OmrScanJob> {
  omrQueue ??= new Queue(QUEUE_NAMES.omrScan, { connection: getRedisConnection() });
  return omrQueue;
}

export function getPdfGenerationQueue(): Queue<PdfGenerationJob> {
  pdfQueue ??= new Queue(QUEUE_NAMES.pdfGeneration, { connection: getRedisConnection() });
  return pdfQueue;
}
