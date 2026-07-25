/**
 * Estado y transiciones de un `QuestionImportJob`.
 *
 * La interfaz del repositorio vive en `domain/` porque el modelo de negocio
 * (qué mutaciones tiene sentido hacer sobre un job) no es detalle de Prisma.
 * El shape concreto (JSON columns, etc.) pertenece a la implementación.
 *
 * Convenciones:
 * - Todos los métodos asumen que la mutación se hace sobre una fila YA EXISTENTE
 *   (creada con `create(input)`). El estado inicial siempre es `QUEUED` con
 *   `bullJobId` ya establecido (necesario para correlación BD ↔ BullMQ).
 * - `findById(institutionId, id)` filtra por tenant: el caller debe conocer la
 *   institución. El SSE endpoint y el admin list sacan el tenant del actor, no
 *   de la URL, para evitar fugas cross-tenant.
 * - Los métodos `setX` no leen antes de escribir: el caller ya pasó por
 *   `findById` si necesita el snapshot (patrón load → mutate).
 */
import type { ParsedQuestion } from "./parsed-question";
import type { QuestionExtractProgress } from "./question-import-queue";

export type { QuestionExtractProgress } from "./question-import-queue";

/** Estado público del job. Coincide con la columna `status` (string). */
export type QuestionImportJobStatus = "QUEUED" | "PROCESSING" | "DONE" | "FAILED";

/**
 * Vista deserializada de un `QuestionImportJob` para consumir desde use cases
 * y SSE. El shape de BD (JSON columns) se aplana aquí para que la UI no
 * tenga que conocer el esquema.
 */
export interface QuestionImportJobSnapshot {
  id: string;
  institutionId: string;
  uploadedById: string;
  evaluationId: string | null;
  status: QuestionImportJobStatus;
  pdfRelativePath: string;
  /** Presente cuando `status === "DONE"`. */
  result: ParsedQuestion[];
  warnings: string[];
  errorMessage: string | null;
  bullJobId: string | null;
  progressPhase: string | null;
  progressDone: number | null;
  progressOf: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Datos que el server action pasa al crear la fila tras subir el PDF. */
export interface CreateQuestionImportJobInput {
  id: string;
  institutionId: string;
  uploadedById: string;
  evaluationId: string | null;
  pdfRelativePath: string;
  /** Ya encolado en BullMQ; persistido al crear la fila para correlación. */
  bullJobId: string;
}

/**
 * Repositorio del job de importación. Implementado por
 * `PrismaQuestionImportJobRepository`; la capa de aplicación solo conoce esta
 * interfaz, lo que mantiene `application/` libre de `@prisma/client`
 * (regla del repo, ver eval-app/ARCHITECTURE.md).
 */
export interface QuestionImportJobRepository {
  create(input: CreateQuestionImportJobInput): Promise<void>;

  /**
   * Busca un job por id filtrando por institución. Devuelve `null` si no
   * existe O si pertenece a otra institución (un único punto de control
   * para evitar fugas cross-tenant).
   */
  findById(institutionId: string, id: string): Promise<QuestionImportJobSnapshot | null>;

  /**
   * Asocia el id del job en BullMQ a la fila. Se llama DESPUÉS de encolar,
   * cuando `Queue.add(...)` ya devolvió el id. Permite correlar logs y
   * correlacionar reintentos.
   */
  setBullJobId(id: string, bullJobId: string): Promise<void>;

  /** Marca `status` y opcionalmente un `errorMessage` legible. */
  setStatus(id: string, status: QuestionImportJobStatus, errorMessage?: string): Promise<void>;

  /** Actualiza la fase y contadores del progreso reportado por el pipeline. */
  setProgress(id: string, progress: QuestionExtractProgress): Promise<void>;

  /**
   * Persiste el resultado final del job y cierra la transición a `DONE` en
   * la misma operación. `warnings` se guarda aparte para que la UI lo pueda
   * mostrar sin parsear el `result`.
   */
  setResult(id: string, result: ParsedQuestion[], warnings: string[]): Promise<void>;
}