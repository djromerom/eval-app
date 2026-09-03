/**
 * Filtros de la consulta "Listado de Formulaciones". Todos opcionales.
 *
 * Se aplican client-side sobre el array ya cargado en la UI (`admin/consultas/[id]`).
 * El servidor entrega la lista completa de la institución del actor; los filtros
 * son UX, no scoping (el scoping ya lo hace `ListFormulaciones.execute()` con
 * tenant + rol).
 *
 * Decisión deliberada: el listado por institución raramente pasa de 100-300
 * formulaciones y todos los filtros son proyecciones cheap; un fetch por cada
 * cambio de filtro sería over-engineering. Si en el futuro el dataset crece
 * a >500 filas, se evoluciona a `searchParams`-driven en `page.tsx` (igual
 * que `/coordinator/review`).
 */
export interface FormulacionesFilters {
  /** Texto libre; matchea (case-insensitive, contains) contra título, asignatura
   *  y nombre del docente autor. */
  search?: string;
  /** Filtra por asignatura (nombre exacto). */
  subjectName?: string;
  /** Filtra por grado (Course.name exacto, p.ej. "10-1", "11-2"). */
  courseName?: string;
  /** Filtra por año académico. */
  academicYearYear?: number;
  /** Filtra por estado del workflow (DRAFT / IN_REVIEW / APPROVED / PUBLISHED). */
  status?: import("@/modules/evaluations/domain/evaluation-status").EvaluationStatus;
}

/** Construye el bag de filtros desde los searchParams de la URL. Cualquier valor
 *  fuera del enum o vacío se descarta sin error. */
export function parseFormulacionesFilters(
  sp: Partial<Record<keyof FormulacionesFilters, string | undefined>>,
): FormulacionesFilters {
  const out: FormulacionesFilters = {};
  if (sp.search && sp.search.trim()) out.search = sp.search.trim();
  if (sp.subjectName && sp.subjectName.trim()) out.subjectName = sp.subjectName.trim();
  if (sp.courseName && sp.courseName.trim()) out.courseName = sp.courseName.trim();
  if (sp.academicYearYear && /^\d+$/.test(sp.academicYearYear)) {
    out.academicYearYear = Number(sp.academicYearYear);
  }
  if (
    sp.status &&
    (sp.status === "DRAFT" ||
      sp.status === "IN_REVIEW" ||
      sp.status === "APPROVED" ||
      sp.status === "PUBLISHED")
  ) {
    out.status = sp.status;
  }
  return out;
}

/** Aplica los filtros sobre un array de filas. Helper puro para tests y para la UI. */
export function applyFormulacionesFilters<
  T extends {
    title: string;
    subjectName: string;
    courseName: string;
    academicYearYear: number;
    status: import("@/modules/evaluations/domain/evaluation-status").EvaluationStatus;
    authorName: string;
  },
>(rows: T[], f: FormulacionesFilters): T[] {
  return rows.filter((r) => {
    if (f.subjectName && r.subjectName !== f.subjectName) return false;
    if (f.courseName && r.courseName !== f.courseName) return false;
    if (f.academicYearYear && r.academicYearYear !== f.academicYearYear) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.search && f.search.trim()) {
      const term = f.search.trim().toLowerCase();
      const haystack = `${r.title} ${r.subjectName} ${r.authorName}`.toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  });
}
