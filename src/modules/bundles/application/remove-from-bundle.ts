import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { NotFoundError, type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import type { BundleRepository } from "../domain/bundle";
import { isLocked } from "../domain/bundle-status";

export interface RemoveFromBundleInput {
  actor: AuthenticatedUser;
  bundleId: string;
  itemId: string;
}

/**
 * Quita un item del bundle. Solo SUPER_ADMIN. Solo si DRAFT.
 */
export class RemoveFromBundle implements UseCase<RemoveFromBundleInput, void> {
  constructor(private readonly bundles: BundleRepository) {}

  async execute({ actor, bundleId, itemId }: RemoveFromBundleInput): Promise<Result<void>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    const bundle = await this.bundles.findById(actor.institutionId, bundleId);
    if (!bundle) return fail(new NotFoundError("Cuadernillo", bundleId));
    if (isLocked(bundle.status)) {
      return fail(
        new ValidationError(
          "El cuadernillo está sellado (READY). Desmárcate primero para quitar items.",
        ),
      );
    }

    const removed = await this.bundles.removeItem(actor.institutionId, bundleId, itemId);
    if (!removed) {
      return fail(new NotFoundError("Item del cuadernillo", itemId));
    }
    return ok(undefined);
  }
}
