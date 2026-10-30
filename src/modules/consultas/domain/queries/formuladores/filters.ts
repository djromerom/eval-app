/**
 * Filtros de la consulta "Docentes formuladores por cuadernillo". Todos
 * opcionales.
 *
 * Se aplican client-side sobre el array ya cargado en la UI
 * (`admin/consultas/[id]`), igual que en las otras consultas del módulo: el
 * servidor entrega la lista completa de la institución del actor y los
 * filtros son UX, no scoping (el scoping lo hace el use case + el fetcher).
 *
 * `search` matchea contra todo lo que el docente/usuario podría buscar por
 * teclado: nombre del docente, cuadernillo, grado, asignatura, correo y
 * número de documento.
 */
import type { EstadoCobertura, FormuladorRow } from "./formulador-row";

export interface FormuladoresFilters {
  /** Texto libre (case-insensitive, contains). */
  search?: string;
  /** Filtra por cuadernillo (nombre exacto). */
  cuadernillo?: string;
  /** Filtra por grado (Course.name exacto). */
  grado?: string;
  /** Filtra por asignatura (Subject.name exacto). */
  asignatura?: string;
  /** Filtra por estado de cobertura. */
  estado?: EstadoCobertura;
}

const ESTADOS: readonly EstadoCobertura[] = ["formulado", "formulado-por-otro", "pendiente"];

/** Construye el bag de filtros desde los searchParams de la URL. Cualquier
 *  valor fuera del enum o vacío se descarta sin error. */
export function parseFormuladoresFilters(
  sp: Partial<Record<keyof FormuladoresFilters, string | undefined>>,
): FormuladoresFilters {
  const out: FormuladoresFilters = {};
  if (sp.search && sp.search.trim()) out.search = sp.search.trim();
  if (sp.cuadernillo && sp.cuadernillo.trim()) out.cuadernillo = sp.cuadernillo.trim();
  if (sp.grado && sp.grado.trim()) out.grado = sp.grado.trim();
  if (sp.asignatura && sp.asignatura.trim()) out.asignatura = sp.asignatura.trim();
  if (sp.estado && (ESTADOS as readonly string[]).includes(sp.estado)) {
    out.estado = sp.estado as EstadoCobertura;
  }
  return out;
}

/** Aplica los filtros sobre un array de filas. Helper puro para tests y UI. */
export function applyFormuladoresFilters(
  rows: FormuladorRow[],
  f: FormuladoresFilters,
): FormuladorRow[] {
  return rows.filter((r) => {
    if (f.cuadernillo && r.cuadernillo !== f.cuadernillo) return false;
    if (f.grado && r.grado !== f.grado) return false;
    if (f.asignatura && r.asignatura !== f.asignatura) return false;
    if (f.estado && r.estado !== f.estado) return false;
    if (f.search && f.search.trim()) {
      const term = f.search.trim().toLowerCase();
      const haystack = [
        r.formulador,
        r.cuadernillo,
        r.grado,
        r.asignatura,
        r.email ?? "",
        r.documento ?? "",
        r.formulacion ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  });
}
