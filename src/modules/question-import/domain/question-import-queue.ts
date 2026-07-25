/**
 * Contrato compartido entre el server action que encola la importación y el
 * worker BullMQ que la procesa. Vive en `domain/` (no en `infrastructure/`)
 * porque los tipos del job son parte del modelo: el boundary de la cola es
 * detalle de implementación, pero su shape es contrato del módulo.
 */
import type { ParsedQuestion } from "./parsed-question";

/** Nombre de la cola BullMQ. Se reutiliza en `queues.ts` y el worker. */
export const QUEUE_NAME_QUESTION_EXTRACT = "question-extract";

/**
 * Payload que el server action mete en la cola. Es lo único que cruza el
 * límite proceso Next → worker: nada de archivos en base64 (van por storage
 * compartido). El `pdfRelativePath` apunta al PDF ya subido por el action
 * a `STORAGE_DIR/imports/{institutionId}/...`.
 */
export interface QuestionExtractJob {
  jobId: string;
  institutionId: string;
  uploadedById: string;
  evaluationId: string | null;
  /** Path dentro de STORAGE_DIR, p. ej. `imports/<inst>/<uuid>.pdf`. */
  pdfRelativePath: string;
  /** Modelo para el pase de extracción (default del provider). */
  extractModel?: string;
  /** Modelo para el pase de "solve" (default del provider). */
  solveModel?: string;
}

/**
 * Estados por los que pasa un `QuestionImportJob`. Coinciden con los strings
 * que se guardan en la columna `status` para no arrastrar un enum Prisma
 * extra cuando el dominio ya tiene 4 valores.
 */
export type QuestionImportStatus = "QUEUED" | "PROCESSING" | "DONE" | "FAILED";

/** Eventos de progreso que emite el pipeline de saber-extractor, mapeados
 *  al subconjunto que la UI necesita para pintar la barra de carga. */
export type QuestionExtractProgress =
  | { phase: "queued" }
  | { phase: "split"; totalPages: number; chunks: number }
  | { phase: "extract"; chunk: number; of: number; pages: number[] }
  | {
      phase: "extract-done";
      questions: number;
      contexts: number;
      missing: number[];
    }
  | { phase: "solve"; solved: number; of: number }
  | { phase: "images"; done: number; of: number }
  | { phase: "uploading"; figuresDone: number; of: number }
  | { phase: "assemble"; questions: number };

/** Evento SSE serializado a JSON y enviado al cliente. */
export interface QuestionExtractSseEvent {
  type: "progress" | "done" | "error";
  /** Estado de progreso (solo presente cuando type === "progress"). */
  progress?: QuestionExtractProgress;
  /** Resultado final (solo presente cuando type === "done"). */
  questions?: ParsedQuestion[];
  warnings?: string[];
  /** Mensaje de error legible para el docente (solo cuando type === "error"). */
  error?: string;
}
