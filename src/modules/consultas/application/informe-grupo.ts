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
  type ConsolidarInformeGrupoInput,
  consolidarInformeGrupo,
} from "../domain/queries/informe-grupo/consolidar";
import {
  type InformeGrupo,
  type InformeGrupoOpciones,
  pruebaPorDefecto,
} from "../domain/queries/informe-grupo/informe-grupo";
import type { LeaderScopeReader } from "./list-calificaciones";

/** Datos crudos para consolidar un grupo en una prueba. */
export interface DatosInformeGrupo extends ConsolidarInformeGrupoInput {
  prueba: { id: string; name: string; academicYearId: string };
  grupo: { id: string; name: string; courseName: string; courseId: string; academicYearId: string };
}

export interface InformeGrupoReader {
  /** Pruebas de la institución y grupos, acotados a `courseIds` si viene
   *  (líder ECU). Una lista vacía significa "ningún grado": sin grupos. */
  listOpciones(institutionId: string, courseIds?: string[]): Promise<InformeGrupoOpciones>;
  /** `null` si el grupo o la prueba no son de la institución. */
  cargarDatos(
    institutionId: string,
    periodId: string,
    groupId: string,
  ): Promise<DatosInformeGrupo | null>;
}

export interface GetInformeGrupoInput {
  actor: AuthenticatedUser;
  periodId?: string;
  groupId?: string;
}

export interface GetInformeGrupoOutput {
  opciones: InformeGrupoOpciones;
  /** Lo que queda seleccionado en los filtros; la prueba se preselecciona
   *  (la actual) si no vino una. */
  seleccion: { periodId: string | null; groupId: string | null };
  /** `null` mientras falte la prueba o el grupo, o si la selección no es válida. */
  informe: InformeGrupo | null;
  /** Por qué no hay informe para la selección (grupo fuera del alcance, de
   *  otro año, inexistente). Viaja como dato y no como `fail` para que la
   *  pantalla conserve los filtros y el usuario pueda elegir otro grupo. */
  error: { code: DomainError["code"]; message: string } | null;
}

/**
 * Informe detallado por grupo. Mismo acceso que la consulta de
 * calificaciones: ECU_MASTER y SUPER_ADMIN ven toda la institución; el
 * ECU_LIDER solo los grupos de sus grados asignados (un grupo fuera de su
 * alcance responde FORBIDDEN, no un informe vacío que lo haría pensar que no
 * hay datos).
 */
export class GetInformeGrupo implements UseCase<GetInformeGrupoInput, GetInformeGrupoOutput> {
  constructor(
    private readonly reader: InformeGrupoReader,
    private readonly scope: LeaderScopeReader,
  ) {}

  async execute({
    actor,
    periodId,
    groupId,
  }: GetInformeGrupoInput): Promise<Result<GetInformeGrupoOutput>> {
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
      return sinInforme(
        new ValidationError("El grupo no pertenece al año académico de la prueba seleccionada."),
      );
    }

    return ok({ opciones, seleccion, informe: consolidarInformeGrupo(datos), error: null });
  }
}
