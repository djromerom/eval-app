/**
 * Agregación de ÍTEMS FORMULADOS por tupla (Prueba × Grado × Asignatura ×
 * Tipo de cuadernillo).
 *
 * La consulta "Regla de conteo" muestra, por regla, cuántos
 * ítems (preguntas) se han formulado ya: se suman los ítems de las
 * formulaciones que caen en la MISMA tupla que la regla.
 *
 * Por qué la suma y no un conteo de formulaciones: la regla exige un número
 * EXACTO de ítems por formulario, así que lo que le sirve al administrador
 * es "de los N ítems que exige la regla, cuántos hay ya redactados".
 *
 * Función pura (no toca I/O, ni Next, ni BD) → testeable sin setup.
 */

/** Lo mínimo que hay que saber de una formulación para sumarla. */
export interface FormulacionItems {
  /** Prueba (periodo). `null` = formulación sin prueba (diagnóstica). */
  periodId: string | null;
  /** Grado (curso). */
  courseId: string;
  /** Asignatura. */
  subjectId: string;
  /** Tipo de cuadernillo. `null` = sin tipo asignado. */
  bookletTypeId: string | null;
  /** Ítems (preguntas) que tiene la formulación. */
  totalQuestions: number;
}

/**
 * Clave de la tupla que identifica a la regla. El `_` es sentinel de
 * "sin valor" (puede ser una evaluación sin prueba o sin tipo de cuadernillo).
 */
export function tupleKey(
  periodId: string | null,
  courseId: string,
  subjectId: string,
  bookletTypeId: string | null,
): string {
  return `${periodId ?? "_"}|${courseId}|${subjectId}|${bookletTypeId ?? "_"}`;
}

/**
 * Devuelve el mapa tupla → ítems formulados (sumados).
 *
 * Las formulaciones que no caen en ninguna tupla con regla simplemente no
 * aparecen en el mapa: el llamador las ignora.
 */
export function sumItemsPorTupla(formulaciones: readonly FormulacionItems[]): Map<string, number> {
  const itemsPorTupla = new Map<string, number>();
  for (const f of formulaciones) {
    const key = tupleKey(f.periodId, f.courseId, f.subjectId, f.bookletTypeId);
    itemsPorTupla.set(key, (itemsPorTupla.get(key) ?? 0) + f.totalQuestions);
  }
  return itemsPorTupla;
}
