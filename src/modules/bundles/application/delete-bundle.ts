import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { NotFoundError, type Result, fail, ok } from "@/shared/domain/result";
import type { BundleRepository } from "../domain/bundle";

export interface DeleteBundleInput {
  actor: AuthenticatedUser;
  bundleId: string;
}

/**
 * Elimina el bundle. Solo SUPER_ADMIN. Cualquier estado es válido
 * (los datos son de prueba según el usuario; en producción probablemente
 * se prefiere soft-delete pero Sprint 1 hace hard-delete).
 *
 * Cascade en BD: al borrar el bundle se borran sus items.
 * Los AnswerSheet con bundleId = id tienen SET NULL, así que las hojas
 * legacy quedan con `bundleId = NULL` y `evaluationId` queda apuntando
 * a la evaluation original (si existía).
 */
export class DeleteBundle implements UseCase<DeleteBundleInput, void> {
  constructor(private readonly bundles: BundleRepository) {}

  async execute({ actor, bundleId }: DeleteBundleInput): Promise<Result<void>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    const existing = await this.bundles.findById(actor.institutionId, bundleId);
    if (!existing) return fail(new NotFoundError("Cuadernillo", bundleId));

    await this.bundles.delete(actor.institutionId, bundleId);
    return ok(undefined);
  }
}
