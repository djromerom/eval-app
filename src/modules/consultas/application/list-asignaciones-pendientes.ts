/**
 * Use case: lista las **asignaciones pendientes** de la institución del actor
 * — las tuplas (Prueba × Grado × Asignatura × Tipo de cuadernillo) que la regla
 * de conteo exige y que todavía no tienen formulación.
 *
 * Es el complemento del listado de formulaciones: sin esto, el listado solo
 * muestra lo que ya está escrito y el admin no ve lo que falta por formular
 * en cada prueba.
 *
 * Scoping: mismo gate que `ListFormulaciones` (ECU_MASTER / SUPER_ADMIN) —
 * son la misma consulta.
 */
import { requireRole, type AuthenticatedUser } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ok } from "@/shared/domain/result";
import type { AsignacionPendiente } from "../domain/queries/formulaciones/asignacion-pendiente";

/** Puerto (interface) del que depende el use case. La impl vive en
 *  `infrastructure/` (ver `asignaciones-pendientes-fetcher.ts`). */
export interface AsignacionesPendientesReader {
  /** Asignaciones sin formular de la institución, de todas sus pruebas. */
  listPending(institutionId: string): Promise<AsignacionPendiente[]>;
}

export interface ListAsignacionesPendientesInput {
  actor: AuthenticatedUser;
}

export class ListAsignacionesPendientes implements UseCase<
  ListAsignacionesPendientesInput,
  AsignacionPendiente[]
> {
  constructor(private readonly reader: AsignacionesPendientesReader) {}

  async execute({
    actor,
  }: ListAsignacionesPendientesInput): Promise<Result<AsignacionPendiente[]>> {
    const authorized = requireRole(actor, "ECU_MASTER", "SUPER_ADMIN");
    if (!authorized.ok) return authorized;
    return ok(await this.reader.listPending(actor.institutionId));
  }
}
