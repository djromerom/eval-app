/**
 * Filtros de la consulta "Regla de conteo".
 *
 * Se aplican client-side sobre el array ya cargado en la UI
 * (`admin/consultas/reglas-conteo`). El scoping (tenant + rol) lo hace el
 * use case; el filtro de prueba es UX.
 *
 * La tabla de reglas es chica (decenas de filas por institución: una por
 * tupla grado × asignatura × tipo × prueba), así que un fetch por cada
 * cambio de filtro sería over-engineering.
 */
export interface ReglasConteoFilters {
  /** Filtra por Prueba (Period.id). Sin valor = todas las pruebas. */
  periodId?: string;
  /** Filtra por grado (Course.name exacto). */
  courseName?: string;
  /** Filtra por asignatura (Subject.name exacto). */
  subjectName?: string;
}

/** Construye el bag de filtros desde los searchParams de la URL. Cualquier
 *  valor vacío se descarta sin error. */
export function parseReglasConteoFilters(
  sp: Partial<Record<keyof ReglasConteoFilters, string | undefined>>,
): ReglasConteoFilters {
  const out: ReglasConteoFilters = {};
  if (sp.periodId && sp.periodId.trim()) out.periodId = sp.periodId.trim();
  if (sp.courseName && sp.courseName.trim()) out.courseName = sp.courseName.trim();
  if (sp.subjectName && sp.subjectName.trim()) out.subjectName = sp.subjectName.trim();
  return out;
}

/** Aplica los filtros sobre un array de filas. Helper puro para tests y UI. */
export function applyReglasConteoFilters<
  T extends {
    periodId: string;
    courseName: string;
    subjectName: string;
  },
>(rows: T[], f: ReglasConteoFilters): T[] {
  return rows.filter((r) => {
    if (f.periodId && r.periodId !== f.periodId) return false;
    if (f.courseName && r.courseName !== f.courseName) return false;
    if (f.subjectName && r.subjectName !== f.subjectName) return false;
    return true;
  });
}
