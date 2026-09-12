/**
 * Puntaje de una hoja en escala 0-10, con piso institucional.
 *
 *     puntaje = max(3, 10 * aciertos / total)
 *
 * El piso de 3 es una decisión de la institución, no una propiedad de la
 * medición: un estudiante con 0 aciertos igual recibe 3. Vive acá y no en el
 * pipeline de calificación a propósito — el motor OMR guarda el dato crudo
 * (`totalCorrect` / `totalQuestions`) y esta consulta lo presenta según la
 * política vigente. Si la política cambia, cambia esta función y el histórico
 * se re-expresa solo, sin migrar datos.
 *
 * Ojo: `AnswerSheet.score` NO es esto. Hoy el pipeline guarda ahí el conteo
 * crudo de aciertos (`score: totalCorrect`), que es lo mismo que la columna
 * "Correctas". Por eso la consulta no lo usa.
 */
export const PUNTAJE_MINIMO = 3;
export const PUNTAJE_MAXIMO = 10;

/** `null` si la hoja aún no tiene datos para calcularlo (sin calificar, o
 *  sin total de preguntas). Redondeado a 1 decimal. */
export function calcularPuntaje(
  aciertos: number | null,
  total: number | null,
): number | null {
  if (aciertos === null || total === null || total <= 0) return null;
  const crudo = (PUNTAJE_MAXIMO * aciertos) / total;
  const conPiso = Math.max(PUNTAJE_MINIMO, crudo);
  return Math.round(conPiso * 10) / 10;
}
