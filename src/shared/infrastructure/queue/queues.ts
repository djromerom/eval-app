import { Queue, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { env } from "@/config/env";
import type { PrintKind } from "@/shared/infrastructure/crypto/print-token";
import type {
  QuestionExtractJob,
  QuestionExtractSseEvent,
} from "@/modules/question-import/domain/question-import-queue";

/**
 * Colas BullMQ (ver REQUERIMIENTOS_v2.md §3.6):
 * - omr-scan: procesa cada hoja escaneada (QR → alineación → burbujas → calificación)
 * - pdf-generation: genera PDFs server-side (Puppeteer)
 * - question-extract: extrae preguntas de PDFs subidos por docentes con IA
 *   (saber-extractor + poppler para figuras). Múltiples docentes en paralelo.
 * Los consumidores viven en workers/ y corren como procesos PM2 aparte.
 */
export const QUEUE_NAMES = {
  omrScan: "omr-scan",
  pdfGeneration: "pdf-generation",
  questionExtract: "question-extract",
} as const;

export interface OmrScanJob {
  answerSheetId: string;
  scanBatchId: string;
  institutionId: string;
  imagePath: string;
}

/**
 * Job de generación de PDF server-side. Soporta dos familias:
 *   - formulación única: lleva evaluationId + kind ∈ {booklet, answer-sheets, answer-key}
 *   - cuadernillo:        lleva bundleId + kind ∈ {bundle, answer-sheets-bundle}
 * El campo del identificador que NO aplique debe ser undefined (XOR en runtime).
 *
 * `extraQuery` se concatena a la URL de Puppeteer. Sirve para pasar p.ej.
 * `students=<csv>` en la hoja de respuestas del cuadernillo (Sprint 2).
 */
export interface PdfGenerationJob {
  evaluationId?: string;
  bundleId?: string;
  institutionId: string;
  kind: PrintKind;
  /** Query string extra (sin `?` inicial), p.ej. "students=id1,id2". */
  extraQuery?: string;
  /** Texto del header a estampar en cada página del PDF (esquina superior
   *  izquierda) usando pdf-lib. Si está presente, el worker lo dibuja sobre
   *  CADA página del PDF resultante — útil cuando el header HTML+CSS se ve
   *  solo en la primera página de cada sheet (limitación de Chrome con
   *  position:fixed dentro de multicolumna). Si no se envía, no se estampa
   *  nada (compatibilidad con jobs que no requieren header persistente). */
  pageHeader?: string;
}

/** Resultado que el worker devuelve al completar el job. */
export interface PdfGenerationResult {
  evaluationId?: string;
  bundleId?: string;
  institutionId: string;
  kind: PrintKind;
  path: string;
}

/**
 * Resultado que el worker `question-extract` devuelve al completar el job.
 * El handler serializa los eventos SSE que la UI verá a través del endpoint
 * `/api/import/[jobId]/stream`.
 */
export interface QuestionExtractResult {
  jobId: string;
  status: "DONE" | "FAILED";
  questionsCount: number;
  warningsCount: number;
  sseEvents?: QuestionExtractSseEvent[];
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
let questionExtractQueue: Queue<QuestionExtractJob> | undefined;

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

export function getQuestionExtractQueue(): Queue<QuestionExtractJob> {
  questionExtractQueue ??= new Queue(QUEUE_NAMES.questionExtract, {
    connection: getRedisConnection(),
    prefix: getBullMQPrefix(),
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 200 },
    },
  });
  return questionExtractQueue;
}

let pdfQueueEvents: QueueEvents | undefined;
let questionExtractEvents: QueueEvents | undefined;

/** Necesario para esperar el resultado de un job (Job.waitUntilFinished). */
export function getPdfQueueEvents(): QueueEvents {
  pdfQueueEvents ??= new QueueEvents(QUEUE_NAMES.pdfGeneration, {
    connection: getRedisConnection(),
    prefix: getBullMQPrefix(),
  });
  return pdfQueueEvents;
}

/**
 * Cola de eventos para la importación de preguntas. Permite a la UI
 * suscribirse vía SSE y recibir el resultado del job sin polling.
 */
export function getQuestionExtractEvents(): QueueEvents {
  questionExtractEvents ??= new QueueEvents(QUEUE_NAMES.questionExtract, {
    connection: getRedisConnection(),
    prefix: getBullMQPrefix(),
  });
  return questionExtractEvents;
}
