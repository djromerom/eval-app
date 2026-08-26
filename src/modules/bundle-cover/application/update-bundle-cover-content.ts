/**
 * Use case: UpdateBundleCoverContent.
 * ===================================
 *
 * Persiste el override de `coverContent` por compendio (sobre
 * `EvaluationBundle.coverContent`). Espejo de `UpdateBundleTheme`
 * (`src/modules/bundles/application/update-bundle-theme.ts`).
 *
 * Reglas de negocio:
 *   • Solo `ECU_MASTER` / `ECU_LIDER` pueden editar el copy de la portada
 *     del compendio — mismo criterio que `UpdateBundleTheme` (el override
 *     de portada es contenido imprimible y por-compendio, igual que el tema).
 *   • Solo en DRAFT. Si el compendio está READY (sello verde) se rechaza
 *     — el contenido imprimible es inmutable mientras el compendio está
 *     aprobado, como ocurre con el theme y los items.
 *   • El `null` resetea al institucional (comportamiento idéntico a
 *     `UpdateBundleTheme` con `theme = null`).
 *
 * Validación: el use case re-pasa el objeto por `parseCoverContent()` antes
 * de persistir, descartando campo por campo lo inválido (igual que en el
 * read path). Defensa en profundidad: aunque el server action ya validó
 * con `CoverContentSchema`, si algo llega mal formado por bypass (curl,
 * otro caller del contenedor) NO se escribe en la BD un JSON corrupto.
 *
 * Por qué se inyecta el repo de bundles y NO se accede a Prisma directo:
 * misma razón que `UpdateBundleTheme` — queremos que el use case sea
 * unit-testable con el `InMemoryBundleRepository` sin tocar Postgres.
 */
import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { NotFoundError, type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import { type Bundle, type BundleRepository } from "@/modules/bundles/domain/bundle";
import { isLocked } from "@/modules/bundles/domain/bundle-status";
import { parseCoverContent } from "../domain/cover-content";

export interface UpdateBundleCoverContentInput {
  actor: AuthenticatedUser;
  bundleId: string;
  /**
   * Override del copy de portada. `null` resetea al institucional. Si es
   * un objeto, se re-pasa por `parseCoverContent()` antes de persistir.
   */
  coverContent: unknown | null;
}

export class UpdateBundleCoverContent implements UseCase<UpdateBundleCoverContentInput, Bundle> {
  constructor(private readonly bundles: BundleRepository) {}

  async execute({
    actor,
    bundleId,
    coverContent,
  }: UpdateBundleCoverContentInput): Promise<Result<Bundle>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    const existing = await this.bundles.findById(actor.institutionId, bundleId);
    if (!existing) return fail(new NotFoundError("Cuadernillo", bundleId));
    if (isLocked(existing.status)) {
      return fail(
        new ValidationError(
          "El cuadernillo está sellado (READY). Desmárcate primero para cambiar el contenido de portada.",
        ),
      );
    }

    // Defensa: si el caller pasó un objeto, lo filtramos campo por campo
    // para no escribir basura en la BD. Si no es objeto (string, number,
    // array), lo tratamos como `null` (reset) en vez de escribir tipos
    // absurdos en el JSONB.
    const sanitized: unknown =
      coverContent === null
        ? null
        : typeof coverContent === "object" && !Array.isArray(coverContent)
          ? parseCoverContent(coverContent)
          : null;

    const updated = await this.bundles.update(actor.institutionId, bundleId, {
      coverContent: sanitized,
    });
    return ok(updated);
  }
}
