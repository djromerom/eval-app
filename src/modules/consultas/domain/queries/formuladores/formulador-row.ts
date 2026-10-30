/**
 * DTO de la consulta "Docentes formuladores por cuadernillo".
 *
 * Una fila = la relación "docente ↔ cuadernillo ↔ grado ↔ asignatura", con
 * los datos de contacto del docente. La consulta tiene DOS orígenes:
 *
 *  - `asignacion`: el docente está ASIGNADO (`TeacherSubjectAssignment`) a ese
 *    tipo de cuadernillo para ese grado-asignatura. Es la fila que responde
 *    "¿a quién le toca formular este cuadernillo?". El `estado` dice si ya
 *    está formulating (por él o por otro) o si sigue pendiente.
 *
 *  - `formulacion`: existe una formulación (`Evaluation`) para ese
 *    grado-asignatura-tipo y NO hay ningún docente asignado a ella. Es la
 *    fila que responde "¿quién formuló esto sin asignación?".
 *
 * Decisión de copy — la columna "Cuadernillo" mezcla dos cosas a propósito:
 * en las filas de asignación es el TIPO de cuadernillo ("Estándar"), que es
 * literalmente lo que el docente tiene asignado; en las de formulación es el
 * nombre del cuadernillo (compendio) o el título de la formulación, que es
 * lo que identifica el trabajo ya hecho. La columna "Prueba" desambigua
 * (el mismo nombre de tipo se repite en cada Prueba).
 */

/** De dónde sale la fila. */
export type OrigenFila = "asignacion" | "formulacion";

/**
 * Estado de cobertura del cuadernillo:
 *  - `formulado`: el docente de la fila ya formuló ese cuadernillo.
 *  - `formulado-por-otro`: existe la formulación, pero la hizo otro docente.
 *  - `pendiente`: no hay formulación para esa asignación.
 */
export type EstadoCobertura = "formulado" | "formulado-por-otro" | "pendiente";

/** Texto visible de cada estado (tabla y XLSX). */
export const ESTADO_LABEL: Record<EstadoCobertura, string> = {
  formulado: "Formulado",
  "formulado-por-otro": "Formulado por otro",
  pendiente: "Pendiente",
};

/** Texto de la columna "Cuadernillo" cuando la asignación aplica a cualquier
 *  tipo de cuadernillo (`bookletTypeId = null`). */
export const CUALQUIER_CUADERNILLO = "Cualquier cuadernillo";

/** Placeholder para los datos de contacto que el docente no tiene cargados. */
export const SIN_DATO = "—";

export interface FormuladorRow {
  /** Id estable de la fila (la asignación o la evaluación). */
  id: string;
  /** De dónde sale la fila. */
  origen: OrigenFila;
  /** Cuadernillo. En las filas de asignación es el TIPO de cuadernillo
   *  ("Estándar") o "Cualquier cuadernillo"; en las de formulación, el
   *  nombre del cuadernillo (compendio) o el título de la formulación. */
  cuadernillo: string;
  /** Nombre de la Prueba (periodo) del cuadernillo. Null si no aplica. */
  prueba: string | null;
  /** Año académico del curso / de la formulación. */
  anio: number | null;
  /** Grado (`Course.name`, p.ej. "10-1"). */
  grado: string;
  /** Asignatura (`Subject.name`). */
  asignatura: string;
  /** Nombre del docente. */
  formulador: string;
  /** Tipo de documento ("C.C." / "C.E."). Null si el docente no tiene ficha. */
  tipoDocumento: string | null;
  /** Número de documento. Null si el docente no tiene ficha. */
  documento: string | null;
  /** Correo del docente. */
  email: string | null;
  /** Celular del docente. Null si el docente no tiene ficha. */
  celular: string | null;
  /** Título de la formulación asociada, si la hay. */
  formulacion: string | null;
  /** Estado de cobertura del cuadernillo. */
  estado: EstadoCobertura;
}

/** Etiqueta de la columna "Prueba": "I Periodo · 2026" (o solo el año). */
export function pruebaLabel(r: Pick<FormuladorRow, "prueba" | "anio">): string {
  if (r.prueba && r.anio) return `${r.prueba} · ${r.anio}`;
  if (r.prueba) return r.prueba;
  if (r.anio) return String(r.anio);
  return SIN_DATO;
}
