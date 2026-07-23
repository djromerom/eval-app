import { Queue, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { env } from "@/config/env";
import type { PrintKind } from "@/shared/infrastructure/crypto/print-token";

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

/**
 * Job de generación de PDF server-side. Soporta dos familias:
 *   - evaluación única: lleva evaluationId + kind ∈ {booklet, answer-sheets, answer-key}
 *   - compendio:        lleva bundleId + kind ∈ {bundle, answer-sheets-bundle}
 * El campo del identificador que NO aplique debe ser undefined (XOR en runtime).
 *
 * `extraQuery` se concatena a la URL de Puppeteer. Sirve para pasar p.ej.
 * `students=<csv>` en la hoja de respuestas del compendio (Sprint 2).
 */
export interface PdfGenerationJob {
  evaluationId?: string;
  bundleId?: string;
  institutionId: string;
  kind: PrintKind;
  /** Query string extra (sin `?` inicial), p.ej. "students=id1,id2". */
  extraQuery?: string;
}

/** Resultado que el worker devuelve al completar el job. */
export interface PdfGenerationResult {
  evaluationId?: string;
  bundleId?: string;
  institutionId: string;
  kind: PrintKind;
  path: string;
}

let connection: IORedis | undefined;

export function getRedisConnection(): IORedis {
  // maxRetriesPerRequest: null es requerido por BullMQ
  connection ??= new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return connection;
}

/**
 * Prefijo BullMQ leído de `BULLMQ_PREFIX`. Vacío en prod; en staging
 * (u otros ambientes que compartan Redis) se setea a `"stg:"` (o el
 * prefijo que se decida) para que cada ambiente viva bajo su propio
 * namespace y no se pisen jobs. Devuelve `undefined` cuando está vacío
 * para que BullMQ use su prefijo default `"bull:"` (no rompe prod).
 */
export function getBullMQPrefix(): string | undefined {
  return env.BULLMQ_PREFIX ? env.BULLMQ_PREFIX : undefined;
}

let omrQueue: Queue<OmrScanJob> | undefined;
let pdfQueue: Queue<PdfGenerationJob> | undefined;

export function getOmrScanQueue(): Queue<OmrScanJob> {
  omrQueue ??= new Queue(QUEUE_NAMES.omrScan, {
    connection: getRedisConnection(),
    prefix: getBullMQPrefix(),
  });
  return omrQueue;
}

export function getPdfGenerationQueue(): Queue<PdfGenerationJob> {
  pdfQueue ??= new Queue(QUEUE_NAMES.pdfGeneration, {
    connection: getRedisConnection(),
    prefix: getBullMQPrefix(),
  });
  return pdfQueue;
}

let pdfQueueEvents: QueueEvents | undefined;

/** Necesario para esperar el resultado de un job (Job.waitUntilFinished). */
export function getPdfQueueEvents(): QueueEvents {
  pdfQueueEvents ??= new QueueEvents(QUEUE_NAMES.pdfGeneration, {
    connection: getRedisConnection(),
    prefix: getBullMQPrefix(),
  });
  return pdfQueueEvents;
}
