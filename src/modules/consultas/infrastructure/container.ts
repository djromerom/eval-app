/**
 * Composition root del módulo `consultas`. Símil al patrón de `institutions/`
 * y `evaluations/`: factorías `make...()` que devuelven el use case ya
 * configurado con sus dependencias Prisma.
 */
import { ListFormulaciones } from "../application/list-formulaciones";
import { ListFormuladores } from "../application/list-formuladores";
import { ListCalificaciones } from "../application/list-calificaciones";
import { ListReglasConteo } from "../application/list-reglas-conteo";
import { GetInformeGrupo } from "../application/informe-grupo";
import { PrismaFormulacionesReader } from "./formulaciones-fetcher";
import { PrismaFormuladoresReader } from "./formuladores-fetcher";
import { PrismaCalificacionesReader } from "./calificaciones-fetcher";
import { PrismaReglasConteoReader } from "./reglas-conteo-fetcher";
import { PrismaInformeGrupoReader } from "./informe-grupo-fetcher";
import { PrismaLeaderAssignmentRepository } from "@/modules/leader-assignments/infrastructure/prisma-leader-assignment-repository";

/** Singletons (una sola instancia por proceso, sin estado entre requests). */
const reader = new PrismaFormulacionesReader();
const formuladoresReader = new PrismaFormuladoresReader();
const calificacionesReader = new PrismaCalificacionesReader();
const reglasConteoReader = new PrismaReglasConteoReader();
const informeGrupoReader = new PrismaInformeGrupoReader();

export const makeListFormulaciones = () => new ListFormulaciones(reader);

/** Reglas de conteo de ítems con cuántas formulaciones lleva cada una. */
export const makeListReglasConteo = () => new ListReglasConteo(reglasConteoReader);

/** Docentes formuladores por cuadernillo: asignaciones + formulaciones sin
 *  docente asignado. */
export const makeListFormuladores = () => new ListFormuladores(formuladoresReader);

/** El alcance por grado del ECU_LIDER sale del repo de asignaciones de
 *  líderes, que ya expone `listAssignedCourseIds`. Se reutiliza esa clase en
 *  vez de escribir otra query para que "a qué grados alcanza un líder" tenga
 *  una sola definición en el sistema. */
const leaderScope = new PrismaLeaderAssignmentRepository();

export const makeListCalificaciones = () =>
  new ListCalificaciones(calificacionesReader, leaderScope);

/** Informe detallado por grupo: mismo alcance del líder que calificaciones. */
export const makeGetInformeGrupo = () => new GetInformeGrupo(informeGrupoReader, leaderScope);
