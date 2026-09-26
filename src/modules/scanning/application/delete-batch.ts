import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { DomainError, type Result, fail, ok } from "@/shared/domain/result";
import type { ScanningRepository } from "../domain/answer-sheet";

export interface DeleteBatchInput {
  actor: AuthenticatedUser;
  batchId: string;
}

export interface DeleteBatchOutput {
  batchId: string;
}

/** Eliminar un lote entero de escaneo.
 *
 *  Reglas, en orden (cada una con código estable para la UI):
 *   1. Rol: TEACHER o ECU_LIDER (mismos que ven la lista de lotes).
 *   2. El batch existe, pertenece a la institución del actor y el actor
 *      tiene acceso (filtro idéntico a `getBatchesAction:254`: dueño de
 *      la formulación / bundle institucional / uploadedBy para
 *      unclassified). Defensa en profundidad contra id adivinados.
 *   3. El repo borra: archivos físicos + filas AnswerSheet (cascade borra
 *      StudentAnswer) + filas UnclassifiedScan (cascade de ScanBatch) +
 *      la fila ScanBatch misma.
 *
 *  Decisiones explícitas:
 *   - NO filtrar por estado del batch. El docente aceptó perder calificadas.
 *   - NO soft-delete. NO campos `deletedAt` en ScanBatch: borrar de verdad.
 *   - NO audit log persistente (los `console.log` TEMP DEBUG en el repo
 *     quedan como rastro pasivo, per MEMORY rule "Mantener console.log
 *     TEMP DEBUG en eval-app").
 *   - NO bloquear si hay jobs BullMQ activos. Los jobs en vuelo del worker
 *     llaman a `processSheet` que devuelve `{ok: false, NOT_FOUND}` cuando
 *     la hoja ya no existe; el worker marca el job como COMPLETED con
 *     `error` en `returnvalue` sin lanzar (ver `workers/omr.worker.ts`).
 *   - NO `processedSheets` recontar: bug preexistente del worker, mezclar
 *     dos temas empeoraría el reporte.
 */
export class DeleteBatch implements UseCase<DeleteBatchInput, DeleteBatchOutput> {
  constructor(private readonly repo: ScanningRepository) {}

  async execute(input: DeleteBatchInput): Promise<Result<DeleteBatchOutput>> {
    const { actor } = input;
    const auth = requireRole(actor, "TEACHER", "ECU_LIDER");
    if (!auth.ok) return auth;

    // Filtro multi-target, mismo OR que getBatchesAction:254 y DeleteSheet.
    const access = await this.repo.findBatchAccess(input.batchId);
    if (!access) {
      return fail(new DomainError("NOT_FOUND", "Lote no encontrado."));
    }
    if (access.institutionId !== actor.institutionId) {
      // No leak: si el lote existe pero pertenece a otra institución,
      // respondemos igual que si no existiera.
      return fail(new DomainError("NOT_FOUND", "Lote no encontrado."));
    }
    const allowed =
      (access.evaluation && access.evaluation.teacherId === actor.userId) ||
      (access.bundle && access.bundle.institutionId === actor.institutionId) ||
      // Lote sin clasificar: sólo lo subió el actor, así que él decide.
      (!access.evaluation && !access.bundle && access.uploadedBy === actor.userId);
    if (!allowed) {
      return fail(new DomainError("FORBIDDEN", "No tienes permisos sobre este lote."));
    }

    await this.repo.deleteBatch(input.batchId);

    // Auditoría best-effort: secundaria al evento de borrado. Si falla
    // loggeamos pero NO rompemos la operación. El use case no conoce los
    // conteos finales (los borra el repo con cascade); guardamos sólo lo
    // que el actor puede haber visto antes — el batchId y el shortId.
    // Conteos detallados vendrían del log del repo si los necesitamos.
    try {
      await this.repo.recordDeletionAudit({
        actorUserId: actor.userId,
        actorRoles: actor.roles,
        action: "BATCH_DELETED",
        entityType: "ScanBatch",
        entityId: input.batchId,
        entityShortId: input.batchId.slice(0, 8),
      });
    } catch (auditErr) {
      console.error("[DeleteBatch] audit log falló (no-rolling-back)", auditErr);
    }

    return ok({ batchId: input.batchId });
  }
}
