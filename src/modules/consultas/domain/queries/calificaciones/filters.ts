import { ESTADOS, type EstadoCalificacion } from "./estado";

/**
 * Filtros de la consulta "Calificaciones". Todos opcionales.
 *
 * Igual que en `formulaciones`, se aplican **client-side** sobre el array ya
 * cargado: el servidor entrega lo que el actor tiene permitido ver y estos
 * filtros son UX, no seguridad. El scoping por grado del ECU_LIDER lo hace
 * `ListCalificaciones.execute()` contra sus cursos asignados — un líder no
 * puede ampliar su alcance tocando el filtro, porque las filas de otros
 * grados nunca salieron del servidor.
 */
export interface CalificacionesFilters {
  /** Estado de la ÚLTIMA hoja del estudiante. `"todas"` o ausente = sin
   *  filtrar. Ojo: filtra la fila ya elegida, no elige cuál fila se muestra —
   *  esa siempre es la última hoja del estudiante. */
  estado?: EstadoCalificacion | "todas";
  /** Grado (`Course.id`). */
  courseId?: string;
  /** Grupo (`Group.id`). Si el grupo no pertenece al grado elegido, el
   *  resultado queda vacío: es coherente y no hace falta validarlo aparte. */
  groupId?: string;
  /** Prueba / periodo (`Period.id`). */
  periodId?: string;
  /** Tipo de cuadernillo (`BookletType.id`). */
  bookletTypeId?: string;
}

/** Construye el bag de filtros desde searchParams. Valores vacíos o fuera del
 *  enum se descartan sin error. */
export function parseCalificacionesFilters(
  sp: Partial<Record<keyof CalificacionesFilters, string | undefined>>,
): CalificacionesFilters {
  const out: CalificacionesFilters = {};
  if (sp.courseId && sp.courseId.trim()) out.courseId = sp.courseId.trim();
  if (sp.groupId && sp.groupId.trim()) out.groupId = sp.groupId.trim();
  if (sp.periodId && sp.periodId.trim()) out.periodId = sp.periodId.trim();
  if (sp.bookletTypeId && sp.bookletTypeId.trim()) out.bookletTypeId = sp.bookletTypeId.trim();
  if (sp.estado === "todas" || ESTADOS.some((e) => e.valor === sp.estado)) {
    out.estado = sp.estado as EstadoCalificacion | "todas";
  }
  return out;
}

/** Aplica los filtros sobre un array de filas. Puro: lo usan la UI y los tests. */
export function applyCalificacionesFilters<
  T extends {
    courseId: string;
    groupId: string;
    periodId: string | null;
    bookletTypeId: string | null;
    estado: EstadoCalificacion;
  },
>(rows: T[], f: CalificacionesFilters): T[] {
  return rows.filter((r) => {
    if (f.courseId && r.courseId !== f.courseId) return false;
    if (f.groupId && r.groupId !== f.groupId) return false;
    if (f.periodId && r.periodId !== f.periodId) return false;
    if (f.bookletTypeId && r.bookletTypeId !== f.bookletTypeId) return false;
    if (f.estado && f.estado !== "todas" && r.estado !== f.estado) return false;
    return true;
  });
}
