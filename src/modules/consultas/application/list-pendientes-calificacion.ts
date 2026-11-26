/**
 * Consulta "Pendientes de calificación": qué estudiantes de un grupo, en una
 * prueba, no tienen calificación o no marcaron ninguna opción de respuesta.
 *
 * Alcance por rol — el mismo de la consulta de calificaciones y el del informe
 * por grupo:
 *
 *   - `ECU_MASTER` / `SUPER_ADMIN`: ven toda la institución.
 *   - `ECU_LIDER`: ve **solo** los grupos de los grados que tiene asignados en
 *     `LeaderCourseAssignment`. El recorte se hace en el servidor, no en la
 *     UI: los grupos de otros grados nunca se serializan al cliente.
 *
 * Los filtros (prueba y grupo) viajan en la URL porque el informe se arma en
 * el servidor para esa selección. Sin los dos no hay informe, pero sí se
 * devuelven las opciones para que el usuario pueda elegir.
 */
import {
  requireRole,
  hasRole,
  type AuthenticatedUser,
} from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import {
  type DomainError,
  ForbiddenError,
  NotFoundError,
  type Result,
  ValidationError,
  ok,
} from "@/shared/domain/result";
import {
  type ConsolidarPendientesInput,
  consolidarPendientes,
} from "../domain/queries/pendientes-calificacion/consolidar";
import type { PendientesInforme } from "../domain/queries/pendientes-calificacion/pendiente";
import type { OpcionesPruebaGrupo } from "../domain/shared/opciones-prueba-grupo";
import { pruebaPorDefecto } from "../domain/queries/informe-grupo/informe-grupo";
import type { LeaderScopeReader } from "./list-calificaciones";

export type DatosPendientes = ConsolidarPendientesInput;

export interface PendientesCalificacionReader {
  /** Pruebas de la institución y grupos, acotados a `courseIds` si viene
   *  (líder ECU). Una lista vacía significa "ningún grado": sin grupos. */
  listOpciones(institutionId: string, courseIds?: string[]): Promise<OpcionesPruebaGrupo>;
  /** `null` si el grupo o la prueba no son de la institución. */
  cargarDatos(
    institutionId: string,
    periodId: string,
    groupId: string,
  ): Promise<DatosPendientes | null>;
}

export interface ListPendientesCalificacionInput {
  actor: AuthenticatedUser;
  periodId?: string;
  groupId?: string;
}

export interface ListPendientesCalificacionOutput {
  opciones: OpcionesPruebaGrupo;
  /** Lo que queda seleccionado en los filtros; la prueba se preselecciona
   *  (la actual) si no vino una. */
  seleccion: { periodId: string | null; groupId: string | null };
  /** `null` mientras falte la prueba o el grupo, o si la selección no es
   *  válida. */
  informe: PendientesInforme | null;
  /** Por qué no hay informe para la selección. Viaja como dato y no como
   *  `fail` para que la pantalla conserve los filtros y el usuario pueda
   *  elegir otro grupo. */
  error: { code: DomainError["code"]; message: string } | null;
}

export class ListPendientesCalificacion implements UseCase<
  ListPendientesCalificacionInput,
  ListPendientesCalificacionOutput
> {
  constructor(
    private readonly reader: PendientesCalificacionReader,
    private readonly scope: LeaderScopeReader,
  ) {}

  async execute({
    actor,
    periodId,
    groupId,
  }: ListPendientesCalificacionInput): Promise<Result<ListPendientesCalificacionOutput>> {
    const authorized = requireRole(actor, "ECU_MASTER", "SUPER_ADMIN", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    const courseIds = hasRole(actor, "ECU_MASTER", "SUPER_ADMIN")
      ? undefined
      : await this.scope.listAssignedCourseIds(actor.institutionId, actor.userId);
    const opciones = await this.reader.listOpciones(actor.institutionId, courseIds);

    const prueba = periodId
      ? (opciones.pruebas.find((p) => p.id === periodId) ?? null)
      : pruebaPorDefecto(opciones.pruebas);
    const seleccion = { periodId: prueba?.id ?? periodId ?? null, groupId: groupId || null };
    const sinInforme = (e: DomainError) =>
      ok({ opciones, seleccion, informe: null, error: { code: e.code, message: e.message } });

    if (periodId && !prueba) return sinInforme(new NotFoundError("Prueba", periodId));
    if (!prueba || !groupId) return ok({ opciones, seleccion, informe: null, error: null });

    if (!opciones.grupos.some((g) => g.id === groupId)) {
      // Master: el grupo no es de la institución. Líder: no es de sus grados.
      return sinInforme(
        courseIds
          ? new ForbiddenError("No tienes acceso a los grupos de ese grado.")
          : new NotFoundError("Grupo", groupId),
      );
    }

    const datos = await this.reader.cargarDatos(actor.institutionId, prueba.id, groupId);
    if (!datos) return sinInforme(new NotFoundError("Grupo", groupId));
    if (datos.grupo.academicYearId !== datos.prueba.academicYearId) {
      // Sanidad: el grupo y la prueba deben ser del mismo año académico.
      return sinInforme(
        new ValidationError("El grupo no pertenece al año académico de la prueba seleccionada."),
      );
    }

    return ok({ opciones, seleccion, informe: consolidarPendientes(datos), error: null });
  }
}
