/**
 * Informe detallado por grupo (Consultas).
 *
 * Una fila por estudiante activo del grupo y una columna por asignatura, con
 * el puntaje 0-10 con piso de 3 (`calcularPuntaje`). Consolida TODOS los
 * cuadernillos del grado en la prueba: por estudiante y asignatura se suman
 * correctas y total de todas sus hojas vigentes y se calcula el puntaje una
 * sola vez (promediar puntajes con piso distorsiona).
 *
 * Reglas (acordadas con el docente, sep 2026):
 *   - Hoja vigente = la más reciente por (estudiante, cuadernillo), la misma
 *     regla que la consulta de calificaciones. Si no está calificada (sin
 *     score: pendiente o en reproceso) no aporta, y las asignaturas de ese
 *     cuadernillo quedan vacías para el estudiante aunque otro cuadernillo
 *     tenga nota (no se muestra un parcial como si fuera la nota final).
 *   - Las preguntas inhabilitadas del cuadernillo no cuentan; las marcas
 *     múltiples cuentan como incorrectas (misma semántica que el resumen).
 *   - ITEM = número de lista impreso en la hoja de respuestas: posición por
 *     apellidos entre TODOS los estudiantes del grupo (incluidos retirados),
 *     igual que la impresión. Se listan solo los activos, así que puede saltar
 *     números.
 *   - Columnas en el orden de los cuadernillos (número de cuadernillo, luego
 *     creación) y dentro de cada uno el orden de sus formulaciones.
 *   - Etiqueta de columna = sigla de la asignatura; sin sigla, el nombre.
 */

export interface PuntajeCelda {
  puntaje: number;
  correctas: number;
  total: number;
  /** `isCorrect === false` (incluye marcas múltiples). */
  incorrectas: number;
  /** `selectedKey === "BLANCO" || selectedKey === null`. */
  enBlanco: number;
}

export interface AsignaturaColumna {
  subjectId: string;
  /** Sigla, o el nombre completo si la asignatura no tiene sigla. */
  etiqueta: string;
  nombre: string;
}

export interface FilaInformeGrupo {
  /** Número de lista impreso en la hoja. `null` no debería pasar (el
   *  estudiante siempre está en su grupo), pero se tolera. */
  item: number | null;
  studentId: string;
  nombre: string;
  codigo: string;
  /** Por `subjectId`. `null` = sin dato (celda vacía). */
  puntajes: Record<string, PuntajeCelda | null>;
}

export interface InformeGrupo {
  prueba: { id: string; name: string; year: number };
  grupo: { id: string; name: string; courseName: string };
  /** Cuadernillos del grado en la prueba, en el orden de las columnas. */
  cuadernillos: { id: string; name: string }[];
  asignaturas: AsignaturaColumna[];
  filas: FilaInformeGrupo[];
}

/** Opciones de los filtros (ya acotadas al alcance del actor). */
export interface OpcionPrueba {
  id: string;
  name: string;
  academicYearId: string;
  year: number;
  /** Prueba actual dentro de su año. */
  isCurrent: boolean;
  /** El año de la prueba es el año académico actual. */
  yearIsCurrent: boolean;
}

export interface OpcionGrupo {
  id: string;
  name: string;
  courseName: string;
  academicYearId: string;
}

export interface InformeGrupoOpciones {
  pruebas: OpcionPrueba[];
  grupos: OpcionGrupo[];
}

/** Prueba preseleccionada cuando el usuario no eligió una: la actual del año
 *  actual; si no hay, la actual de cualquier año; si no, la primera. */
export function pruebaPorDefecto(pruebas: readonly OpcionPrueba[]): OpcionPrueba | null {
  return (
    pruebas.find((p) => p.isCurrent && p.yearIsCurrent) ??
    pruebas.find((p) => p.isCurrent) ??
    pruebas[0] ??
    null
  );
}
