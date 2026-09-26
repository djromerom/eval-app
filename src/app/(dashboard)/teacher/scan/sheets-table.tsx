"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { ScanStatusBadge } from "@/components/evaluations/scan-status-badge";
import { DeleteSheetButton } from "./delete-sheet-button";
import {
  SHEET_STATUSES,
  filterSheetsByStatus,
  countSheetsByStatus,
  type SheetRowForFilter,
  type SheetStatus,
} from "./sheet-table-helpers";

// Re-export del tipo para no romper importadores existentes
// (`batch-cards-list.tsx` y otros). El tipo vive en helpers porque debe
// poder importarse desde tests sin arrastrar server actions.
export type { SheetRowForFilter };

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
              <th className="px-3 py-2 text-right font-medium">Acciones</th>
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
                <td className="px-3 py-2 text-right">
                  {s.status === "REVIEW" ? (
                    <DeleteSheetButton
                      batchId={batchId}
                      sheetId={s.id}
                      shortId={s.id.slice(0, 8)}
                    />
                  ) : null}
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
