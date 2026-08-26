import { randomUUID } from "node:crypto";
import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { ValidationError, fail, ok, type Result } from "@/shared/domain/result";
import { getQuestionExtractQueue, QUEUE_NAMES } from "@/shared/infrastructure/queue/queues";
import {
  makeUploadFileForInstitution,
  type UploadFileFn,
} from "@/shared/infrastructure/uploads/file-upload";
import type { QuestionImportJobRepository } from "../domain/question-import-job";
import type { QuestionExtractJob } from "../domain/question-import-queue";

export interface EnqueueQuestionImportInput {
  actor: AuthenticatedUser;
  file: Buffer;
  fileName: string;
  evaluationId?: string | null;
}

export interface EnqueueQuestionImportResult {
  jobId: string;
}

/** Tope máximo del PDF subido. 15 MB alineado con el resto de uploads. */
const MAX_PDF_BYTES = 15 * 1024 * 1024;

const ALLOWED_EXTS = new Set(["pdf"]);

/**
 * Use case "subir PDF + encolar".
 *
 * El docente sube un PDF; este use case:
 *  1. Valida permisos y extensión.
 *  2. Genera `jobId`.
 *  3. Sube el PDF al storage institucional (`imports/{inst}/{jobId}.pdf`)
 *     para que el worker pueda recuperarlo sin serializar bytes en Redis.
 *  4. Encola en `Queue('question-extract')` con el `jobId` para correlación.
 *  5. Crea la fila `QuestionImportJob{status=QUEUED, bullJobId=...}` en BD,
 *     ya con el `bullJobId` para que el admin/log pueda correlacionarlos.
 *  6. Devuelve el `jobId` al server action, que se lo pasa al cliente para
 *     abrir el SSE.
 *
 * Orden de operaciones: encolamos primero y luego persistimos en BD con el
 * `bullJobId` resultante. Si la BD falla, dejamos que BullMQ reintente — el
 * handler vuelve a consultar `findById(institutionId, jobId)` y, si no
 * existe la fila, el job falla rápido con un error claro (en vez de un
 * worker zombie que intente procesar un PDF que "existe" en la cola).
 *
 * Devolver `Result<{ jobId }>` (no throws) sigue el patrón del resto del
 * módulo. La capa HTTP mapea `DomainError.code` → status code.
 */
export class EnqueueQuestionImport
  implements UseCase<EnqueueQuestionImportInput, EnqueueQuestionImportResult>
{
  constructor(
    private readonly repo: QuestionImportJobRepository,
    private readonly uploadFile: UploadFileFn = makeUploadFileForInstitution(),
    private readonly enqueue: (
      payload: QuestionExtractJob,
    ) => Promise<{ bullJobId: string }> = defaultEnqueue,
  ) {}

  async execute({
    actor,
    file,
    fileName,
    evaluationId,
  }: EnqueueQuestionImportInput): Promise<Result<EnqueueQuestionImportResult>> {
    const authorized = requireRole(actor, "TEACHER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXTS.has(ext)) {
      return fail(new ValidationError("Solo se aceptan archivos PDF."));
    }
    if (file.byteLength === 0) {
      return fail(new ValidationError("El archivo está vacío."));
    }
    if (file.byteLength > MAX_PDF_BYTES) {
      return fail(
        new ValidationError(
          `El PDF pesa ${(file.byteLength / 1024 / 1024).toFixed(1)} MB; máximo permitido ${MAX_PDF_BYTES / 1024 / 1024} MB.`,
        ),
      );
    }

    const jobId = randomUUID();
    const uploaded = await this.uploadFile({
      institutionId: actor.institutionId,
      bytes: file,
      extension: "pdf",
    });
    if ("error" in uploaded) {
      return fail(new ValidationError(uploaded.error));
    }

    // Encolamos primero para conocer el `bullJobId` antes de persistir.
    const { bullJobId } = await this.enqueue({
      jobId,
      institutionId: actor.institutionId,
      uploadedById: actor.userId,
      evaluationId: evaluationId ?? null,
      pdfRelativePath: uploaded.relativePath,
    });

    await this.repo.create({
      id: jobId,
      institutionId: actor.institutionId,
      uploadedById: actor.userId,
      evaluationId: evaluationId ?? null,
      pdfRelativePath: uploaded.relativePath,
      bullJobId,
    });

    return ok({ jobId });
  }
}

async function defaultEnqueue(
  payload: QuestionExtractJob,
): Promise<{ bullJobId: string }> {
  const queue = getQuestionExtractQueue();
  const job = await queue.add(QUEUE_NAMES.questionExtract, payload);
  return { bullJobId: job.id ?? "" };
}
