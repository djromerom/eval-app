/**
 * Composition root del módulo `consultas`. Símil al patrón de `institutions/`
 * y `evaluations/`: factorías `make...()` que devuelven el use case ya
 * configurado con sus dependencias Prisma.
 */
import { ListFormulaciones } from "../application/list-formulaciones";
import { ListAsignacionesPendientes } from "../application/list-asignaciones-pendientes";
import { ListPruebas } from "../application/list-pruebas";
import { ListFormuladores } from "../application/list-formuladores";
import { ListCalificaciones } from "../application/list-calificaciones";
import { ListReglasConteo } from "../application/list-reglas-conteo";
import { GetInformeGrupo } from "../application/informe-grupo";
import { PrismaFormulacionesReader } from "./formulaciones-fetcher";
import { PrismaAsignacionesPendientesReader } from "./asignaciones-pendientes-fetcher";
import { PrismaPruebasReader } from "./pruebas-fetcher";
import { PrismaFormuladoresReader } from "./formuladores-fetcher";
import { PrismaCalificacionesReader } from "./calificaciones-fetcher";
import { PrismaReglasConteoReader } from "./reglas-conteo-fetcher";
import { PrismaInformeGrupoReader } from "./informe-grupo-fetcher";
import { PrismaLeaderAssignmentRepository } from "@/modules/leader-assignments/infrastructure/prisma-leader-assignment-repository";

/** Singletons (una sola instancia por proceso, sin estado entre requests). */
const reader = new PrismaFormulacionesReader();
const asignacionesPendientesReader = new PrismaAsignacionesPendientesReader();
const pruebasReader = new PrismaPruebasReader();
const formuladoresReader = new PrismaFormuladoresReader();
const calificacionesReader = new PrismaCalificacionesReader();
const reglasConteoReader = new PrismaReglasConteoReader();
const informeGrupoReader = new PrismaInformeGrupoReader();

/** El alcance por grado del ECU_LIDER sale del repo de asignaciones de
 *  líderes, que ya expone `listAssignedCourseIds`. Se reutiliza esa clase en
 *  vez de escribir otra query para que "a qué grados alcanza un líder" tenga
 *  una sola definición en el sistema. */
const leaderScope = new PrismaLeaderAssignmentRepository();

/** Maestro de formulaciones. El ECU_LIDER ve solo los grados que tiene
 *  asignados (lo aplica el use case). */
export const makeListFormulaciones = () => new ListFormulaciones(reader, leaderScope);

/** Asignaciones de las pruebas que todavía no tienen formulación (las que la
 *  regla de conteo exige y nadie ha formulado). Mismo alcance por grado que
 *  las formulaciones. */
export const makeListAsignacionesPendientes = () =>
  new ListAsignacionesPendientes(asignacionesPendientesReader, leaderScope);

/** Pruebas de la institución: opciones del filtro "Prueba" del listado de
 *  formulaciones. */
export const makeListPruebas = () => new ListPruebas(pruebasReader);

/** Reglas de conteo de ítems con cuántas formulaciones lleva cada una. */
export const makeListReglasConteo = () => new ListReglasConteo(reglasConteoReader);

/** Docentes formuladores por cuadernillo: asignaciones + formulaciones sin
 *  docente asignado. */
export const makeListFormuladores = () => new ListFormuladores(formuladoresReader);

export const makeListCalificaciones = () =>
  new ListCalificaciones(calificacionesReader, leaderScope);

/** Informe detallado por grupo: mismo alcance del líder que calificaciones. */
export const makeGetInformeGrupo = () => new GetInformeGrupo(informeGrupoReader, leaderScope);
