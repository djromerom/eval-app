"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { ScanStatusBadge } from "@/components/evaluations/scan-status-badge";

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

const SHEET_STATUSES = ["REVIEW", "GRADED", "PROCESSING", "SCANNED", "PENDING"] as const;
type SheetStatus = (typeof SHEET_STATUSES)[number];

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

/** Tabla con un multi-select de chips por estado encima. El estado del
 *  filtro es LOCAL a esta tabla: cada lote del listado tiene la suya, y
 *  cambiar el filtro en uno no afecta a los demás. Cuando no hay chips
 *  marcados, se muestran todas las filas (no se oculta nada al cargar). */
export function SheetsTable({ batchId, sheets }: { batchId: string; sheets: SheetRowForFilter[] }) {
  const [active, setActive] = useState<Set<SheetStatus>>(new Set());

  const counts = useMemo(() => countSheetsByStatus(sheets), [sheets]);
  const visible = useMemo(() => filterSheetsByStatus(sheets, active), [sheets, active]);

  function toggle(s: SheetStatus) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  return (
    <>
      <div className="text-muted-foreground bg-muted/40 flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
        <span className="mr-1 font-medium">Filtrar:</span>
        {SHEET_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={active.has(s)}
            onClick={() => toggle(s)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors",
              active.has(s)
                ? "border-primary/40 bg-primary/10 text-primary"
                : "bg-background text-muted-foreground border-border hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                s === "PENDING" && "bg-yellow-500",
                s === "SCANNED" && "bg-blue-500",
                s === "PROCESSING" && "bg-cyan-500",
                s === "GRADED" && "bg-green-500",
                s === "REVIEW" && "bg-red-500",
                active.has(s) ? "" : "opacity-40",
              )}
              aria-hidden
            />
            <span className="text-foreground">{ScanStatusBadgeLabel(s)}</span>
            <span className="font-semibold">({counts[s]})</span>
          </button>
        ))}
        {active.size > 0 && (
          <button
            type="button"
            onClick={() => setActive(new Set())}
            className="text-muted-foreground hover:text-foreground ml-1 underline"
          >
            Limpiar
          </button>
        )}
      </div>
      {visible.length === 0 ? (
        <p className="text-muted-foreground px-3 py-4 text-xs">
          Este lote no tiene hojas en los estados seleccionados.
        </p>
      ) : (
        <table className="w-full">
          <thead className="bg-muted/40 text-muted-foreground border-b text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Hoja</th>
              <th className="px-3 py-2 font-medium">Estudiante</th>
              <th className="px-3 py-2 font-medium">Código</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 font-medium">Puntaje</th>
              <th className="px-3 py-2 font-medium">Notas</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => (
              <tr key={s.id} className="border-b last:border-0">
                <td className="px-3 py-2 font-mono text-xs">
                  <Link
                    href={`/teacher/scan/${batchId}/${s.id}`}
                    className="text-primary hover:text-foreground underline"
                  >
                    {s.id.slice(0, 8)}
                  </Link>
                </td>
                <td className="px-3 py-2">{s.studentName ?? "—"}</td>
                <td className="px-3 py-2">{s.studentCode ?? "—"}</td>
                <td className="px-3 py-2">
                  <ScanStatusBadge status={s.status} />
                </td>
                <td className="px-3 py-2">
                  {s.score !== null ? `${s.totalCorrect}/${s.totalQuestions}` : "—"}
                </td>
                <td className="text-muted-foreground max-w-40 truncate px-3 py-2">
                  {s.notes ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/** Importo `LABELS` localmente (no en línea arriba porque rompería el "use
 *  client" boundary en el caso de que el archivo se reexporte en server). */
function ScanStatusBadgeLabel(status: SheetStatus): string {
  switch (status) {
    case "REVIEW":
      return "Revisión";
    case "GRADED":
      return "Calificada";
    case "PROCESSING":
      return "Procesando";
    case "SCANNED":
      return "Escaneada";
    case "PENDING":
      return "Pendiente";
  }
}
