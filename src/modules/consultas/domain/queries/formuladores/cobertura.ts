/**
 * Cruce entre asignaciones de docente y formulaciones. **Función pura** (sin
 * I/O ni Prisma) → se testea sin BD.
 *
 * Reglas del cruce:
 *
 *  1. Cada ASIGNACIÓN (`TeacherSubjectAssignment`) produce una fila: es la
 *     respuesta a "¿a quién le toca formular este cuadernillo?". Su estado
 *     dice si ese docente ya formuló el cuadernillo ("formulado"), si lo
 *     formuló otro ("formulado-por-otro") o si sigue "pendiente".
 *
 *  2. Cada FORMULACIÓN que NO cubre ninguna asignación produce una fila
 *     más: es el trabajo ya hecho que no tiene docente asignado.
 *
 *  Cobertura: una asignación con `tipoCuadernilloId = null` aplica a
 *  CUALQUIER tipo de cuadernillo (misma semántica del modelo), así que
 *  cubre también las formulaciones con tipo concreto. Una asignación con
 *  tipo solo cubre las formulaciones de ese mismo tipo.
 */
import { CUALQUIER_CUADERNILLO, type EstadoCobertura, type FormuladorRow } from "./formulador-row";

/** Asignación docente ↔ grado-asignatura ↔ tipo de cuadernillo. */
export interface AsignacionDocente {
  id: string;
  /** Id del tipo de cuadernillo. `null` = cualquier tipo. */
  tipoCuadernilloId: string | null;
  /** Nombre del tipo de cuadernillo (o null si aplica a cualquier tipo). */
  tipoCuadernillo: string | null;
  /** Nombre de la Prueba (periodo) del tipo de cuadernillo. */
  prueba: string | null;
  anio: number | null;
  grado: string;
  asignatura: string;
  /** `CourseSubject.id` — la clave de cruce con la formulación. */
  courseSubjectId: string;
  /** `User.id` del docente (para saber si la formulación es suya). */
  docenteId: string;
  docenteNombre: string;
  tipoDocumento: string | null;
  documento: string | null;
  email: string | null;
  celular: string | null;
}

/** Formulación (última versión) con su autor. */
export interface FormulacionDocente {
  id: string;
  titulo: string;
  courseSubjectId: string;
  tipoCuadernilloId: string | null;
  prueba: string | null;
  anio: number | null;
  grado: string;
  asignatura: string;
  /** `User.id` del autor. */
  autorId: string;
  autorNombre: string;
  email: string | null;
  tipoDocumento: string | null;
  documento: string | null;
  celular: string | null;
  /** Nombre del cuadernillo (compendio) o el título de la formulación. */
  cuadernillo: string;
}

/** Clave de cruce por (grado-asignatura, tipo de cuadernillo). */
function key(courseSubjectId: string, tipoId: string | null): string {
  return `${courseSubjectId}|${tipoId ?? "_"}`;
}

/** Construye las filas de la consulta a partir de los dos conjuntos. */
export function construirFilasFormuladores(
  asignaciones: readonly AsignacionDocente[],
  formulaciones: readonly FormulacionDocente[],
): FormuladorRow[] {
  // Formulaciones indexadas por grado-asignatura (para el cruce).
  const porCourseSubject = new Map<string, FormulacionDocente[]>();
  for (const f of formulaciones) {
    const list = porCourseSubject.get(f.courseSubjectId) ?? [];
    list.push(f);
    porCourseSubject.set(f.courseSubjectId, list);
  }

  // Claves cubiertas por alguna asignación (para detectar formulaciones sin
  // docente asignado).
  const covered = new Set<string>();
  for (const a of asignaciones) {
    covered.add(key(a.courseSubjectId, a.tipoCuadernilloId));
    if (a.tipoCuadernilloId === null) covered.add(key(a.courseSubjectId, null));
  }

  const rows: FormuladorRow[] = [];

  // (1) Una fila por asignación.
  for (const a of asignaciones) {
    const candidatas = (porCourseSubject.get(a.courseSubjectId) ?? []).filter(
      (f) => a.tipoCuadernilloId === null || f.tipoCuadernilloId === a.tipoCuadernilloId,
    );
    const propia = candidatas.find((f) => f.autorId === a.docenteId);
    const estado: EstadoCobertura = propia
      ? "formulado"
      : candidatas.length > 0
        ? "formulado-por-otro"
        : "pendiente";
    const formulacion = propia ?? candidatas[0] ?? null;

    rows.push({
      id: `asignacion:${a.id}`,
      origen: "asignacion",
      cuadernillo: a.tipoCuadernillo ?? CUALQUIER_CUADERNILLO,
      prueba: a.prueba,
      anio: a.anio,
      grado: a.grado,
      asignatura: a.asignatura,
      formulador: a.docenteNombre,
      tipoDocumento: a.tipoDocumento,
      documento: a.documento,
      email: a.email,
      celular: a.celular,
      formulacion: formulacion?.titulo ?? null,
      estado,
    });
  }

  // (2) Filas de las formulaciones que NO cubre ninguna asignación.
  for (const f of formulaciones) {
    const estaCubierta =
      covered.has(key(f.courseSubjectId, f.tipoCuadernilloId)) ||
      covered.has(key(f.courseSubjectId, null));
    if (estaCubierta) continue;

    rows.push({
      id: `formulacion:${f.id}`,
      origen: "formulacion",
      cuadernillo: f.cuadernillo,
      prueba: f.prueba,
      anio: f.anio,
      grado: f.grado,
      asignatura: f.asignatura,
      formulador: f.autorNombre,
      tipoDocumento: f.tipoDocumento,
      documento: f.documento,
      email: f.email,
      celular: f.celular,
      formulacion: f.titulo,
      estado: "formulado",
    });
  }

  // (3) Orden estable de lectura: grado → asignatura → cuadernillo → docente.
  rows.sort((a, b) => {
    const g = a.grado.localeCompare(b.grado, "es");
    if (g !== 0) return g;
    const s = a.asignatura.localeCompare(b.asignatura, "es");
    if (s !== 0) return s;
    const c = a.cuadernillo.localeCompare(b.cuadernillo, "es");
    if (c !== 0) return c;
    return a.formulador.localeCompare(b.formulador, "es");
  });

  return rows;
}
