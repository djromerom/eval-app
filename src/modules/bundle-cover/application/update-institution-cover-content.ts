/**
 * Use case: UpdateInstitutionCoverContent.
 * =========================================
 *
 * Persiste el override institucional del copy de portada
 * (`Institution.coverContent`). Lo edita el admin institucional en
 * `/admin/theme` y se aplica a TODOS los compendios de la institución
 * que no tengan un override propio por-compendio.
 *
 * Precedencia (de mayor a menor, leída por `getResolvedCoverContent()`):
 *   1. `EvaluationBundle.coverContent`  → override del compendio
 *   2. `Institution.coverContent`       → override institucional (ESTE)
 *   3. `DEFAULT_*`                      → built-in de la plantilla
 *
 * Validación: el use case re-pasa el input por `parseCoverContent()` antes
 * de delegar al repo. Defensa en profundidad: aunque el server action ya
 * validó con `CoverContentSchema`, si algo llega mal formado por bypass
 * (curl, otro caller del contenedor) NO se escribe en la BD un JSON corrupto.
 *
 * Roles: `ECU_MASTER` / `SUPER_ADMIN` — el override institucional es
 * contenido imprimible y transversal a todos los compendios, así que solo
 * el admin institucional puede tocarlo (mismo criterio que
 * `UpdateInstitutionTheme`).
 *
 * Persistencia: delega en `InstitutionRepository.setCoverContent` —
 * la capa `application/` no importa Prisma (regla del ESLint config).
 */
import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import type { InstitutionRepository } from "@/modules/institutions/domain/institution";
import { parseCoverContent } from "../domain/cover-content";

export interface UpdateInstitutionCoverContentInput {
  actor: AuthenticatedUser;
  coverContent: unknown | null;
}

export class UpdateInstitutionCoverContent implements UseCase<
  UpdateInstitutionCoverContentInput,
  void
> {
  constructor(private readonly institutions: InstitutionRepository) {}

  async execute({
    actor,
    coverContent,
  }: UpdateInstitutionCoverContentInput): Promise<Result<void>> {
    const authorized = requireRole(actor, "ECU_MASTER", "SUPER_ADMIN");
    if (!authorized.ok) return authorized;

    // Verificamos que la institución del actor existe (defensa — debería
    // existir siempre, pero si fue borrada entre el login y esta request
    // no queremos tirar un 500 con Prisma P2025).
    const inst = await this.institutions.findById(actor.institutionId);
    if (!inst) return fail(new ValidationError("Institución no encontrada."));

    // Defensa: si el caller pasó un objeto, lo filtramos campo por campo
    // para no escribir basura en la BD. Tipos absurdos (string, number,
    // array) se tratan como `null` (reset al DEFAULT_* en runtime).
    const sanitized: Record<string, unknown> | null =
      coverContent === null
        ? null
        : typeof coverContent === "object" && !Array.isArray(coverContent)
          ? parseCoverContent(coverContent)
          : null;

    await this.institutions.setCoverContent(actor.institutionId, sanitized);
    return ok(undefined);
  }
}
