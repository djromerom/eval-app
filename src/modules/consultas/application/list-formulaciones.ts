/**
 * Use case: lista el maestro de formulaciones de la institución del actor.
 *
 * Scoping: solo ECU_MASTER y SUPER_ADMIN (la capability `run-queries` ya
 * gatea el acceso al UI; este `requireRole` es la segunda barrera según el
 * patrón del proyecto: capabilities para UI, use cases para API).
 *
 * Decisión deliberada: NO hereda del branching multi-rol de `ListEvaluations`
 * (TEACHER/ECU_LIDER/ECU_MASTER). La consulta es solo para admin de institución
 * (y super admin para su propia institución). Si en el futuro un ECU_LIDER
 * quiere correr esta consulta, se añade a `requireRole` — no al `ListEvaluations`.
 *
 * Devuelve `FormulacionRow[]` (DTO enriquecido del módulo consultas), NO el
 * `EvaluationListItem` del módulo evaluations: el shape tiene campos extra
 * (`assignedTeachers[]`, `itemsExpected`, `itemsBadge`) que la consulta
 * necesita. Ver `src/modules/consultas/domain/queries/formulaciones/`.
 *
 * Los filtros (search, asignatura, año, estado) los aplica la UI client-side
 * sobre el array devuelto. Ver `parseFormulacionesFilters` + `applyFormulacionesFilters`
 * en `domain/queries/formulaciones/filters.ts`.
 */
import { requireRole, type AuthenticatedUser } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ok } from "@/shared/domain/result";
import type { FormulacionRow } from "../domain/queries/formulaciones/formulacion-row";

/** Puerto (interface) que el use case necesita. La impl vive en `infrastructure/`.
 *  Se inyecta desde el container, lo que permite testear el use case con un
 *  in-memory (ver `tests/unit/list-formulaciones.test.ts`). */
export interface FormulacionesReader {
  /** Devuelve todas las formulaciones (última versión por defecto) de la
   *  institución. Las versiones anteriores NO aparecen — se filtra por
   *  `parentVersionId: null` en el fetcher. */
  listByInstitution(institutionId: string): Promise<FormulacionRow[]>;
}

export interface ListFormulacionesInput {
  actor: AuthenticatedUser;
}

export class ListFormulaciones implements UseCase<ListFormulacionesInput, FormulacionRow[]> {
  constructor(private readonly reader: FormulacionesReader) {}

  async execute({ actor }: ListFormulacionesInput): Promise<Result<FormulacionRow[]>> {
    const authorized = requireRole(actor, "ECU_MASTER", "SUPER_ADMIN");
    if (!authorized.ok) return authorized;
    return ok(await this.reader.listByInstitution(actor.institutionId));
  }
}
