/**
 * Helpers puros del índice de contextos.
 *
 * Viven en un archivo separado del componente cliente para que los unit
 * tests (que corren en Node puro, sin jsdom) puedan importarlos sin
 * arrastrar transitive deps del cliente (next-auth, TipTap, etc.) que
 *ían a romper la resolución de módulos del runner.
 */

/**
 * Estimación muy simple: 2.5 min/pregunta, mínimo 2 min para evitar mostrar
 * "0 min" cuando hay una sola pregunta fácil. Solo se usa como pista visual.
 */
export function estimatedMinutes(questionCount: number): number {
  return Math.max(2, Math.round(questionCount * 2.5));
}
