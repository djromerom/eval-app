import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { NotFoundError, type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import { type Bundle, type BundleRepository } from "../domain/bundle";
import { isLocked } from "../domain/bundle-status";

export interface UpdateBundleThemeInput {
  actor: AuthenticatedUser;
  bundleId: string;
  /** Nuevo theme JSON. `null` resetea al institucional. */
  theme: unknown | null;
}

/**
 * Actualiza el override de theme del bundle. Solo SUPER_ADMIN.
 * Solo si DRAFT (el theme es parte del contenido imprimible).
 *
 * Nota: el theme se valida contra el zod schema de
 * `src/modules/theme/domain/theme.ts` en la capa de infraestructura
 * (no aquí, para mantener la use case libre de dependencias).
 */
export class UpdateBundleTheme implements UseCase<UpdateBundleThemeInput, Bundle> {
  constructor(private readonly bundles: BundleRepository) {}

  async execute({ actor, bundleId, theme }: UpdateBundleThemeInput): Promise<Result<Bundle>> {
    const authorized = requireRole(actor, "SUPER_ADMIN");
    if (!authorized.ok) return authorized;

    const existing = await this.bundles.findById(actor.institutionId, bundleId);
    if (!existing) return fail(new NotFoundError("Compendio", bundleId));
    if (isLocked(existing.status)) {
      return fail(
        new ValidationError(
          "El compendio está sellado (READY). Desmárcate primero para cambiar el tema.",
        ),
      );
    }

    const updated = await this.bundles.update(actor.institutionId, bundleId, {
      theme: theme ?? null,
    });
    return ok(updated);
  }
}
