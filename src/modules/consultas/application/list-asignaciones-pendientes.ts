/**
 * Use case: lista las **asignaciones pendientes** de la institución del actor
 * — las tuplas (Prueba × Grado × Asignatura × Tipo de cuadernillo) que la regla
 * de conteo exige y que todavía no tienen formulación.
 *
 * Es el complemento del listado de formulaciones: sin esto, el listado solo
 * muestra lo que ya está escrito y el admin no ve lo que falta por formular
 * en cada prueba.
 *
 * Alcance por rol: el ECU_LIDER ve solo las pendientes de los grados que tiene
 * asignados, igual que las formulaciones — si no, el listado le mostraría
 * "sin formular" de grados ajenos.
 */
import {
  requireRole,
  hasRole,
  type AuthenticatedUser,
} from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ok } from "@/shared/domain/result";
import type { AsignacionPendiente } from "../domain/queries/formulaciones/asignacion-pendiente";
import type { LeaderScopeReader } from "./list-calificaciones";

/** Puerto (interface) del que depende el use case. La impl vive en
 *  `infrastructure/` (ver `asignaciones-pendientes-fetcher.ts`). */
export interface AsignacionesPendientesReader {
  /** Asignaciones sin formular de la institución, de todas sus pruebas.
   *
   *  `courseIds` acota el resultado a esos grados (ECU_LIDER); `undefined` =
   *  sin acotar. Una lista **vacía** significa "ningún grado asignado" y debe
   *  devolver []. */
  listPending(institutionId: string, courseIds?: string[]): Promise<AsignacionPendiente[]>;
}

export interface ListAsignacionesPendientesInput {
  actor: AuthenticatedUser;
}

export class ListAsignacionesPendientes implements UseCase<
  ListAsignacionesPendientesInput,
  AsignacionPendiente[]
> {
  constructor(
    private readonly reader: AsignacionesPendientesReader,
    private readonly scope: LeaderScopeReader,
  ) {}

  async execute({
    actor,
  }: ListAsignacionesPendientesInput): Promise<Result<AsignacionPendiente[]>> {
    const authorized = requireRole(actor, "ECU_MASTER", "SUPER_ADMIN", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    // El rol más amplio gana: un líder que además es master ve todo.
    if (hasRole(actor, "ECU_MASTER", "SUPER_ADMIN")) {
      return ok(await this.reader.listPending(actor.institutionId));
    }

    const courseIds = await this.scope.listAssignedCourseIds(actor.institutionId, actor.userId);
    if (courseIds.length === 0) return ok([]);
    return ok(await this.reader.listPending(actor.institutionId, courseIds));
  }
}
