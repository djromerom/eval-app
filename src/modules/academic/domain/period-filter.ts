/**
 * Filtro de "prueba" por defecto de los listados.
 *
 * Varios módulos (cuadernillos, escaneo de hojas, listados de formulaciones)
 * trabajan sobre la PRUEBA ACTUAL: la marcada con `Period.isCurrent`. La regla
 * de CUAL es la prueba actual vive en `GetCurrentPeriod`
 * (`academic/application/periods.ts`), que es year-aware: `isCurrent` es una
 * marca POR AÑO ACADÉMICO, así que la actual del año en curso gana sobre la
 * de un año ya cerrado.
 *
 * Este módulo resuelve la otra mitad de la regla: qué hace el listado cuando
 * el filtro de prueba NO viene en la URL.
 *
 * Como el filtro vive en la URL (la fuente de verdad, para que el
 * back-button y los enlaces compartidos funcionen), hay que distinguir tres
 * situaciones que la URL expresa de forma distinta:
 *
 *   - sin `periodId`   → por defecto, la prueba actual;
 *   - `periodId=all`   → el usuario pidió ver TODAS las pruebas;
 *   - `periodId=<id>`  → esa prueba en particular.
 *
 * Sin el centinela "all", la opción "Todas" del select sería indistinguible
 * del default y el listado volvería a la prueba actual en cada recarga.
 */

/** Centinela del filtro de Prueba para "ver todas las pruebas". */
export const ALL_PERIODS = "all";

export interface PeriodFilter {
  /** `periodId` a aplicar a la consulta; `null` = sin filtro de prueba. */
  periodId: string | null;
  /** `true` cuando el usuario pidió explícitamente ver todas las pruebas. */
  showAll: boolean;
}

/**
 * Resuelve el filtro de prueba de un listado a partir de lo que viene en la
 * URL y de cuál es la prueba actual.
 *
 * - `requestedPeriodId` vacío (no se eligió prueba) → la actual.
 * - `requestedPeriodId === ALL_PERIODS` → sin filtro ("Todas").
 * - cualquier otro id → ese.
 *
 * Si no hay prueba actual marcada y no se eligió ninguna, el filtro queda
 * abierto (no hay una prueba vigente que acotar la lista).
 */
export function resolvePeriodFilter(
  requestedPeriodId: string,
  currentPeriodId: string | null,
): PeriodFilter {
  const requested = requestedPeriodId.trim();
  if (requested === ALL_PERIODS) return { periodId: null, showAll: true };
  if (requested) return { periodId: requested, showAll: false };
  return { periodId: currentPeriodId, showAll: false };
}
