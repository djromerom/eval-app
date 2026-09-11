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
  /** Grado (`Course.id`). */
  courseId?: string;
  /** Grupo (`Group.id`). Si el grupo no pertenece al grado elegido, el
   *  resultado queda vacío: es coherente y no hace falta validarlo aparte. */
  groupId?: string;
  /** Prueba / periodo (`Period.id`). */
  periodId?: string;
  /** Tipo de cuadernillo (`BookletType.id`). */
  bookletTypeId?: string;
  /** "calificadas" | "pendientes". Sin valor, muestra ambas. */
  estado?: "calificadas" | "pendientes";
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
  if (sp.estado === "calificadas" || sp.estado === "pendientes") out.estado = sp.estado;
  return out;
}

/** Aplica los filtros sobre un array de filas. Puro: lo usan la UI y los tests. */
export function applyCalificacionesFilters<
  T extends {
    courseId: string;
    groupId: string;
    periodId: string | null;
    bookletTypeId: string | null;
    graded: boolean;
  },
>(rows: T[], f: CalificacionesFilters): T[] {
  return rows.filter((r) => {
    if (f.courseId && r.courseId !== f.courseId) return false;
    if (f.groupId && r.groupId !== f.groupId) return false;
    if (f.periodId && r.periodId !== f.periodId) return false;
    if (f.bookletTypeId && r.bookletTypeId !== f.bookletTypeId) return false;
    if (f.estado === "calificadas" && !r.graded) return false;
    if (f.estado === "pendientes" && r.graded) return false;
    return true;
  });
}
