/** Helpers puros para `SheetsTable`. NO importan server actions ni React —
 *  viven aquí para que `tests/unit/sheets-table-filter.test.ts` no arrastre
 *  dependencias de Next cuando importe estas funciones (cada vez que el
 *  archivo padre importa un server action vía un sub-componente, el test
 *  unitario puro se rompe con `Cannot find module 'next/server'`). */

/** Hoja de un lote, en el formato que devuelve `getBatchesAction`
 *  (`src/app/(dashboard)/teacher/scan/actions.ts`). Solo se listan los 5
 *  estados que aplican a `AnswerSheet.status` (no los del lote:
 *  PENDING/PROCESSING/COMPLETED/PARTIAL/FAILED). */
export interface SheetRowForFilter {
  id: string;
  status: string;
  studentName: string | null;
  studentCode: string | null;
  score: number | null;
  totalCorrect: number | null;
  totalQuestions: number | null;
  notes: string | null;
}

export const SHEET_STATUSES = ["REVIEW", "GRADED", "PROCESSING", "SCANNED", "PENDING"] as const;
export type SheetStatus = (typeof SHEET_STATUSES)[number];

/** Filtra las filas por estado (cliente, OR). Set vacío = sin filtro. Se
 *  exporta para que `tests/unit/sheets-table-filter.test.ts` la pruebe sin
 *  RTL. La función NO muta la lista de entrada. */
export function filterSheetsByStatus<T extends { status: string }>(
  sheets: T[],
  active: ReadonlySet<SheetStatus>,
): T[] {
  if (active.size === 0) return sheets;
  return sheets.filter((s) => active.has(s.status as SheetStatus));
}

/** Cuenta cuántas hojas hay en cada estado, sobre la lista COMPLETA (no
 *  sobre el resultado filtrado). Así el docente ve "Revisión (5)" aunque
 *  aún no haya tocado el filtro. Se exporta por la misma razón. */
export function countSheetsByStatus<T extends { status: string }>(
  sheets: T[],
): Record<SheetStatus, number> {
  const counts: Record<SheetStatus, number> = {
    PENDING: 0,
    SCANNED: 0,
    PROCESSING: 0,
    GRADED: 0,
    REVIEW: 0,
  };
  for (const s of sheets) {
    if (SHEET_STATUSES.includes(s.status as SheetStatus)) {
      counts[s.status as SheetStatus] += 1;
    }
  }
  return counts;
}
