import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { NotFoundError, type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import type { BundleRepository } from "../domain/bundle";
import { isLocked } from "../domain/bundle-status";

export interface ReorderBundleItemsInput {
  actor: AuthenticatedUser;
  bundleId: string;
  /** Lista de itemIds en el orden deseado (1-based: posición 1, 2, 3…). */
  itemIds: string[];
}

/**
 * Reordena los items del bundle. Solo SUPER_ADMIN. Solo si DRAFT.
 *
 * Validaciones:
 *   - itemIds.length debe ser igual al número actual de items del bundle
 *     (no se pueden añadir ni quitar vía reorder — usar add/remove para eso).
 *   - Los itemIds deben ser únicos.
 *   - Todos deben pertenecer al bundle (se valida implícitamente al comparar
 *     con la lista actual).
 */
export class ReorderBundleItems implements UseCase<ReorderBundleItemsInput, void> {
  constructor(private readonly bundles: BundleRepository) {}

  async execute({ actor, bundleId, itemIds }: ReorderBundleItemsInput): Promise<Result<void>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    const bundle = await this.bundles.findById(actor.institutionId, bundleId);
    if (!bundle) return fail(new NotFoundError("Cuadernillo", bundleId));
    if (isLocked(bundle.status)) {
      return fail(
        new ValidationError(
          "El cuadernillo está sellado (READY). Desmárcate primero para reordenar.",
        ),
      );
    }

    const currentItems = await this.bundles.listItemsOrdered(bundleId);
    const currentIds = new Set(currentItems.map((i) => i.id));
    const incomingIds = new Set(itemIds);

    if (itemIds.length === 0) {
      return fail(new ValidationError("La lista de items está vacía."));
    }
    if (itemIds.length !== currentItems.length) {
      return fail(
        new ValidationError(
          `La lista tiene ${itemIds.length} items pero el cuadernillo tiene ${currentItems.length}.`,
        ),
      );
    }
    if (incomingIds.size !== itemIds.length) {
      return fail(new ValidationError("La lista de items contiene duplicados."));
    }
    for (const id of itemIds) {
      if (!currentIds.has(id)) {
        return fail(new NotFoundError("Item del cuadernillo", id));
      }
    }

    await this.bundles.reorderItems(actor.institutionId, bundleId, itemIds);
    return ok(undefined);
  }
}
