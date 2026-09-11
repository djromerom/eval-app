/**
 * Consulta "Calificaciones": una fila por hoja escaneada, con su puntaje.
 *
 * Alcance por rol — es la razón de ser de este use case:
 *
 *   - `ECU_MASTER` / `SUPER_ADMIN`: ven toda la institución, incluidas las
 *     hojas que no se pudieron atribuir a ningún grado.
 *   - `ECU_LIDER`: ve **solo** los grados que tiene asignados en
 *     `LeaderCourseAssignment`. El recorte se hace en el servidor, no en la
 *     UI: las filas de otros grados nunca se serializan al cliente.
 *
 * La consulta lista solo hojas identificadas: una hoja cuyo QR no se resolvió
 * no es la calificación de nadie y se atiende en la revisión del lote. Eso
 * además deja el alcance limpio — toda fila tiene grado, así que no hay
 * hojas "sin grado" que decidir si mostrar o no.
 *
 * Un usuario con ambos roles (líder y master) se trata como master: el rol
 * más amplio gana.
 */
import { requireRole, hasRole, type AuthenticatedUser } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ok } from "@/shared/domain/result";
import type { CalificacionRow } from "../domain/queries/calificaciones/calificacion-row";

export interface CalificacionesReader {
  /** Todas las hojas de la institución, con su grado resuelto.
   *
   *  `courseIds` acota el resultado a esos grados; `undefined` = sin acotar.
   *  Una lista **vacía** significa "ningún grado asignado" y debe devolver []:
   *  no confundir con `undefined`. */
  listByInstitution(institutionId: string, courseIds?: string[]): Promise<CalificacionRow[]>;
}

export interface LeaderScopeReader {
  listAssignedCourseIds(institutionId: string, userId: string): Promise<string[]>;
}

export interface ListCalificacionesInput {
  actor: AuthenticatedUser;
}

export class ListCalificaciones implements UseCase<ListCalificacionesInput, CalificacionRow[]> {
  constructor(
    private readonly reader: CalificacionesReader,
    private readonly scope: LeaderScopeReader,
  ) {}

  async execute({ actor }: ListCalificacionesInput): Promise<Result<CalificacionRow[]>> {
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
