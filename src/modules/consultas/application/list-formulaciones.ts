/**
 * Use case: lista el maestro de formulaciones de la institución del actor.
 *
 * Alcance por rol — es la razón de ser de este use case:
 *
 *   - `ECU_MASTER` / `SUPER_ADMIN`: ven toda la institución.
 *   - `ECU_LIDER`: ve **solo** los grados que tiene asignados en
 *     `LeaderCourseAssignment`. El recorte se hace en el servidor, no en la
 *     UI: las filas de otros grados nunca se serializan al cliente. Es el
 *     mismo alcance que ya usa la consulta de calificaciones.
 *
 * La capability `run-queries` ya gatea el acceso al UI; este `requireRole` es
 * la segunda barrera según el patrón del proyecto: capabilities para UI, use
 * cases para API.
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
import {
  requireRole,
  hasRole,
  type AuthenticatedUser,
} from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ok } from "@/shared/domain/result";
import type { FormulacionRow } from "../domain/queries/formulaciones/formulacion-row";
import type { LeaderScopeReader } from "./list-calificaciones";

/** Puerto (interface) que el use case necesita. La impl vive en `infrastructure/`.
 *  Se inyecta desde el container, lo que permite testear el use case con un
 *  in-memory (ver `tests/unit/list-formulaciones.test.ts`). */
export interface FormulacionesReader {
  /** Devuelve las formulaciones (última versión por defecto) de la
   *  institución. Las versiones anteriores NO aparecen — se filtra por
   *  `parentVersionId: null` en el fetcher.
   *
   *  `courseIds` acota el resultado a esos grados (ECU_LIDER); `undefined` =
   *  sin acotar. Una lista **vacía** significa "ningún grado asignado" y debe
   *  devolver []: no confundir con `undefined`. */
  listByInstitution(institutionId: string, courseIds?: string[]): Promise<FormulacionRow[]>;
}

export interface ListFormulacionesInput {
  actor: AuthenticatedUser;
}

export class ListFormulaciones implements UseCase<ListFormulacionesInput, FormulacionRow[]> {
  constructor(
    private readonly reader: FormulacionesReader,
    private readonly scope: LeaderScopeReader,
  ) {}

  async execute({ actor }: ListFormulacionesInput): Promise<Result<FormulacionRow[]>> {
    const authorized = requireRole(actor, "ECU_MASTER", "SUPER_ADMIN", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    // El rol más amplio gana: un líder que además es master ve todo.
    if (hasRole(actor, "ECU_MASTER", "SUPER_ADMIN")) {
      return ok(await this.reader.listByInstitution(actor.institutionId));
    }

    const courseIds = await this.scope.listAssignedCourseIds(actor.institutionId, actor.userId);
    // Sin grados asignados no hay nada que ver. Cortamos antes de ir a la BD:
    // pasar [] a un `IN ()` es un error facil de cometer del otro lado.
    if (courseIds.length === 0) return ok([]);
    return ok(await this.reader.listByInstitution(actor.institutionId, courseIds));
  }
}
