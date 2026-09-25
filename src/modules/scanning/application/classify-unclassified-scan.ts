import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { DomainError, type Result, fail, ok } from "@/shared/domain/result";
import {
  EstudianteConHojaError,
  type OmrJobQueue,
  type UnclassifiedScanRepository,
} from "../domain/unclassified-scan";

export interface ClassifyUnclassifiedScanInput {
  actor: AuthenticatedUser;
  unclassifiedScanId: string;
  bundleId: string;
  studentId: string;
}

export interface ClassifyUnclassifiedScanOutput {
  sheetId: string;
  /** Lote donde quedó la hoja: puede no ser el de origen. */
  batchId: string;
}

/**
 * Convierte una hoja sin clasificar en una AnswerSheet del cuadernillo y el
 * estudiante que eligió una persona, y la manda a calificar.
 *
 * Reglas, en orden (cada una con código estable para la UI):
 *   1. Rol: TEACHER, ECU_LIDER o ECU_MASTER (los que ven el lote).
 *   2. La hoja sin clasificar es de la institución del actor y no se ha
 *      clasificado todavía.
 *   3. El cuadernillo es de la institución, está LISTO y tiene formulaciones.
 *   4. El estudiante está activo y en un curso del cuadernillo.
 *   5. No tiene ya otra hoja de ese cuadernillo calificada, en cola o
 *      clasificada a mano: sin QR no hay id de papel, y como los reportes
 *      toman la hoja más reciente, una segunda nota taparía la buena. Se
 *      vuelve a mirar dentro de la transacción, con bloqueo, para que dos
 *      clasificaciones simultáneas del mismo estudiante no pasen las dos.
 *
 * La hoja creada lleva el estudiante desde el principio y el worker no lee su
 * QR (`AnswerSheet.identificadaAMano`), así que se califica con lo elegido.
 */
export class ClassifyUnclassifiedScan implements UseCase<
  ClassifyUnclassifiedScanInput,
  ClassifyUnclassifiedScanOutput
> {
  constructor(
    private readonly repo: UnclassifiedScanRepository,
    private readonly queue: OmrJobQueue,
  ) {}

  async execute(
    input: ClassifyUnclassifiedScanInput,
  ): Promise<Result<ClassifyUnclassifiedScanOutput>> {
    const { actor } = input;
    const auth = requireRole(actor, "TEACHER", "ECU_LIDER", "ECU_MASTER");
    if (!auth.ok) return auth;

    const hoja = await this.repo.findById(actor.institutionId, input.unclassifiedScanId);
    if (!hoja) return fail(new DomainError("NOT_FOUND", "Hoja no encontrada."));
    if (hoja.resolvedAt)
      return fail(new DomainError("ALREADY_RESOLVED", "Esta hoja ya se clasificó."));

    const bundle = await this.repo.findBundle(actor.institutionId, input.bundleId);
    if (!bundle || bundle.status !== "READY") {
      return fail(
        new DomainError("BUNDLE_NOT_READY", "El cuadernillo no está LISTO para calificar."),
      );
    }
    if (bundle.courseIds.length === 0) {
      return fail(
        new DomainError(
          "EMPTY_BUNDLE",
          "El cuadernillo no tiene formulaciones; no se puede inferir el curso.",
        ),
      );
    }

    const enCurso = await this.repo.studentInCourses(
      actor.institutionId,
      input.studentId,
      bundle.courseIds,
    );
    if (!enCurso) {
      return fail(
        new DomainError(
          "STUDENT_NOT_IN_COURSE",
          "El estudiante no pertenece a un curso cubierto por este cuadernillo.",
        ),
      );
    }

    const otra = await this.repo.findBlockingSheetOf(bundle.id, input.studentId);
    if (otra) return fail(estudianteConHoja(otra));

    const creada = await this.repo.resolverEnHoja({
      hoja,
      bundleId: bundle.id,
      studentId: input.studentId,
      resolvedBy: actor.userId,
    });
    if (creada === "ALREADY_RESOLVED") {
      return fail(new DomainError("ALREADY_RESOLVED", "Esta hoja ya se clasificó."));
    }
    // Otra clasificación del mismo estudiante ganó la carrera entre el chequeo
    // de arriba y la transacción.
    if ("duplicada" in creada) return fail(estudianteConHoja(creada.duplicada));

    try {
      await this.queue.enqueue({
        answerSheetId: creada.sheetId,
        scanBatchId: creada.batchId,
        institutionId: actor.institutionId,
        imagePath: hoja.filePath,
      });
    } catch {
      // La hoja ya existe: sin cola (Redis caído) queda para Reprocesar desde
      // su detalle, en vez de perder la clasificación.
      await this.repo.marcarNoEncolada(creada.sheetId);
    }

    return ok(creada);
  }
}

function estudianteConHoja(otra: { id: string; scanBatchId: string | null }) {
  return new EstudianteConHojaError(
    "Este estudiante ya tiene una hoja calificada de este cuadernillo.",
    otra.scanBatchId ? { id: otra.id, batchId: otra.scanBatchId } : null,
  );
}
