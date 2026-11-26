/**
 * Opciones de los filtros "Prueba" y "Grupo" de las consultas que se arman en
 * el servidor (informe por grupo, pendientes de calificación).
 *
 * Son las mismas en todas: el catálogo de pruebas de la institución y el de
 * grupos, ya acotados al alcance del actor — el líder ECU solo ve los grupos de
 * los grados que tiene asignados.
 */
import type { PruebaOpcion } from "./prueba-opcion";

export interface OpcionGrupo {
  id: string;
  name: string;
  courseName: string;
  /** Año académico del curso del grupo (`Course.academicYearId`). */
  academicYearId: string;
}

export interface OpcionesPruebaGrupo {
  pruebas: PruebaOpcion[];
  grupos: OpcionGrupo[];
}
