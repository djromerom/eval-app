import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { DomainError, type Result, fail, ok } from "@/shared/domain/result";
import type { ScanningRepository } from "../domain/answer-sheet";

export interface DeleteSheetInput {
  actor: AuthenticatedUser;
  /** Lote de la hoja (se necesita para el filtro de acceso — el docente
   *  sólo puede borrar hojas de lotes que ya podía ver). */
  batchId: string;
  sheetId: string;
}

export interface DeleteSheetOutput {
  /** Lote del que se borró la hoja; lo devuelve el repo. Útil para
   *  revalidar la ruta del lote en el action. */
  batchId: string | null;
}

/** Eliminar una hoja escaneada.
 *
 *  Reglas, en orden (cada una con código estable para la UI):
 *   1. Rol: TEACHER o ECU_LIDER (mismos que ven la lista de lotes).
 *   2. El batch existe, pertenece a la institución del actor y el actor
 *      tiene acceso (filtro idéntico a `getBatchesAction:254`: dueño de
 *      la formulación / bundle institucional / uploadedBy para
 *      unclassified). Defensa en profundidad contra id adivinados.
 *   3. La hoja existe y pertenece a la institución (otra defensa).
 *   4. La hoja está en REVIEW — único estado eliminable. GRADED/PENDING/
 *      SCANNED/PROCESSING/COMPLETED son muro duro (la nota ya cuenta).
 *   5. El repo borra fila + archivos físicos + decrementa totalSheets.
 *
 *  Decisiones explícitas:
 *   - NO soft-delete. El docente quiere borrar de verdad (Sprint: borrar
 *     hojas que el motor no pudo calificar, antes de re-escanear el papel).
 *   - NO recontar `processedSheets` (valor heredado del worker; bug
 *     preexistente; mezclar dos temas empeoraría el reporte).
 *   - NO auditoría (bitácora de cambios) — fuera de alcance.
 */
export class DeleteSheet implements UseCase<DeleteSheetInput, DeleteSheetOutput> {
  constructor(private readonly repo: ScanningRepository) {}

  async execute(input: DeleteSheetInput): Promise<Result<DeleteSheetOutput>> {
    const { actor } = input;
    const auth = requireRole(actor, "TEACHER", "ECU_LIDER");
    if (!auth.ok) return auth;

    // Filtro multi-target, mismo OR que getBatchesAction:254. NO autoria
    // por sí solo — la combinación con `institutionId === actor.inst` (abajo)
    // es la que decide.
    const access = await this.repo.findBatchAccess(input.batchId);
    if (!access) {
      return fail(new DomainError("NOT_FOUND", "Lote no encontrado."));
    }
    if (access.institutionId !== actor.institutionId) {
      // No leak: si la hoja existe pero pertenece a otra institución,
      // respondemos igual que si no existiera.
      return fail(new DomainError("NOT_FOUND", "Lote no encontrado."));
    }
    const allowed =
      (access.evaluation && access.evaluation.teacherId === actor.userId) ||
      (access.bundle && access.bundle.institutionId === actor.institutionId) ||
      // Lote sin clasificar (carga automática donde ninguna hoja clasificó):
      // sólo lo subió el actor, así que él es quien decide.
      (!access.evaluation && !access.bundle && access.uploadedBy === actor.userId);
    if (!allowed) {
      return fail(new DomainError("FORBIDDEN", "No tienes permisos sobre este lote."));
    }

    const sheet = await this.repo.getAnswerSheet(actor.institutionId, input.sheetId);
    if (!sheet) {
      return fail(new DomainError("NOT_FOUND", "Hoja no encontrada."));
    }
    if (sheet.status !== "REVIEW") {
      return fail(new DomainError("INVALID_STATE", "Sólo se pueden eliminar hojas en revisión."));
    }

    const { batchId } = await this.repo.deleteSheet(input.sheetId);

    // Auditoría best-effort: el log es secundario al evento de borrado. Si
    // falla (BD saturada, schema no migrado), loggeamos pero NO rompemos la
    // operación. El docente ya no tiene chance de recuperar la hoja de
    // todos modos. La filmación del `deleteSheet` arriba ya hizo su trabajo.
    try {
      await this.repo.recordDeletionAudit({
        actorUserId: actor.userId,
        actorRoles: actor.roles,
        action: "SHEET_DELETED",
        entityType: "AnswerSheet",
        entityId: input.sheetId,
        entityShortId: input.sheetId.slice(0, 8),
        metadata: batchId ? { batchId, batchShortId: batchId.slice(0, 8) } : {},
      });
    } catch (auditErr) {
      console.error("[DeleteSheet] audit log falló (no-rolling-back)", auditErr);
    }

    return ok({ batchId });
  }
}
