import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import {
  ConflictError,
  NotFoundError,
  type Result,
  ValidationError,
  fail,
  ok,
} from "@/shared/domain/result";
import { type Bundle, type BundleRepository, type UpdateBundleData } from "../domain/bundle";
import { isLocked } from "../domain/bundle-status";
import { isValidBookletNumber, isValidBundleName } from "../domain/bundle-rules";

export interface UpdateBundleInput {
  actor: AuthenticatedUser;
  bundleId: string;
  data: UpdateBundleData;
}

/**
 * Edita metadatos del bundle (nombre, bookletNumber, theme).
 * Solo SUPER_ADMIN. Solo si el bundle está en DRAFT.
 */
export class UpdateBundle implements UseCase<UpdateBundleInput, Bundle> {
  constructor(private readonly bundles: BundleRepository) {}

  async execute({ actor, bundleId, data }: UpdateBundleInput): Promise<Result<Bundle>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    const existing = await this.bundles.findById(actor.institutionId, bundleId);
    if (!existing) return fail(new NotFoundError("Compendio", bundleId));

    if (isLocked(existing.status)) {
      return fail(
        new ValidationError("El compendio está sellado (READY). Desmárcate primero para editarlo."),
      );
    }

    if (data.name !== undefined && !isValidBundleName(data.name)) {
      return fail(
        new ValidationError("El nombre del compendio debe tener entre 3 y 120 caracteres."),
      );
    }
    if (data.bookletNumber !== undefined && !isValidBookletNumber(data.bookletNumber)) {
      return fail(new ValidationError("El número de cuadernillo debe ser un entero positivo."));
    }

    // bookletNumber único
    if (data.bookletNumber !== undefined && data.bookletNumber !== null) {
      const all = await this.bundles.findAll(actor.institutionId);
      const clash = all.find((b) => b.bookletNumber === data.bookletNumber && b.id !== bundleId);
      if (clash) {
        return fail(
          new ConflictError(
            `Ya existe un compendio con el número de cuadernillo ${data.bookletNumber}.`,
          ),
        );
      }
    }

    const updated = await this.bundles.update(actor.institutionId, bundleId, data);
    return ok(updated);
  }
}
