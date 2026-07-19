/**
 * Invariantes puras del Bundle. Validaciones que NO requieren I/O.
 * Las validaciones que requieren consultar el repo viven en las use cases.
 * Ver docs/compendios.md §"Modelo de datos — Reglas de invariante".
 */

/** Estados de evaluation que pueden entrar a un bundle. */
export const PRINTABLE_STATUSES = ["APPROVED", "PUBLISHED"] as const;
export type PrintableEvaluationStatus = (typeof PRINTABLE_STATUSES)[number];

export function isPrintableEvaluationStatus(status: string): status is PrintableEvaluationStatus {
  return (PRINTABLE_STATUSES as readonly string[]).includes(status);
}

/** Nombre del bundle: 3..120 chars, no solo espacios. */
export function isValidBundleName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 3 && trimmed.length <= 120;
}

/** bookletNumber: entero positivo si está definido. */
export function isValidBookletNumber(n: number | null | undefined): boolean {
  if (n === null || n === undefined) return true;
  return Number.isInteger(n) && n > 0;
}

/** Mínimo de items requeridos para marcar el bundle como READY. */
export const MIN_ITEMS_FOR_READY = 1;

/** Tiempo estimado por pregunta en minutos (default configurable por institución). */
export const DEFAULT_MINUTES_PER_QUESTION = 2.5;
