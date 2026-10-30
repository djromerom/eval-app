/**
 * Use case: lista las reglas de conteo de ítems de la institución del actor,
 * con la cuenta de formulaciones que lleva cada regla.
 *
 * Scoping: solo ECU_MASTER y SUPER_ADMIN (mismo criterio que
 * `ListFormulaciones` — la consulta es de administración de institución).
 *
 * Los filtros (prueba, grado, asignatura) los aplica la UI client-side
 * sobre el array devuelto; ver `parseReglasConteoFilters` +
 * `applyReglasConteoFilters` en `domain/queries/reglas-conteo/filters.ts`.
 */
import { requireRole, type AuthenticatedUser } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ok } from "@/shared/domain/result";
import type { ReglaConteoRow } from "../domain/queries/reglas-conteo/regla-conteo-row";

/** Puerto (interface) que el use case necesita. La impl vive en
 *  `infrastructure/`. Se inyecta desde el container, lo que permite testear
 *  el use case con un in-memory (ver `tests/unit/list-reglas-conteo.test.ts`). */
export interface ReglasConteoReader {
  /** Devuelve todas las reglas de conteo de la institución con el nombre de
   *  su prueba, grado, asignatura y tipo, y cuántas formulaciones lleva. */
  listByInstitution(institutionId: string): Promise<ReglaConteoRow[]>;
}

export interface ListReglasConteoInput {
  actor: AuthenticatedUser;
}

export class ListReglasConteo implements UseCase<ListReglasConteoInput, ReglaConteoRow[]> {
  constructor(private readonly reader: ReglasConteoReader) {}
  async execute({ actor }: ListReglasConteoInput): Promise<Result<ReglaConteoRow[]>> {
    const authorized = requireRole(actor, "ECU_MASTER", "SUPER_ADMIN");
    if (!authorized.ok) return authorized;
    return ok(await this.reader.listByInstitution(actor.institutionId));
  }
}
