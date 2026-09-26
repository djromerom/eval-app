"use client";

import Link from "next/link";
import { ScanStatusBadge } from "@/components/evaluations/scan-status-badge";
import { SheetsTable, type SheetRowForFilter } from "./sheets-table";
import { DeleteBatchButton } from "./delete-batch-button";

const df = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" });

/** Subset de `BatchWithSheets` (exportado en `actions.ts`) que el listado
 *  necesita para renderizar las cards. Declarado localmente para no forzar
 *  al server component `page.tsx` a exportar el tipo vía client boundary. */
export interface BatchForList {
  id: string;
  kind: "evaluation" | "bundle" | "unclassified" | "unknown";
  status: string;
  totalSheets: number;
  processedSheets: number;
  createdAt: string | Date;
  title: string | null;
  sinClasificar: number;
  sheets: SheetRowForFilter[];
}

/** Renderiza la lista de cards de lotes. Es client component porque cada
 *  card delega su tabla interna a `<SheetsTable>` (que necesita
 *  `useState`). El card en sí (título, badge del lote, link) no es
 *  interactivo — solo necesita vivir dentro del árbol client. */
export function BatchCardsList({ batches }: { batches: BatchForList[] }) {
  if (batches.length === 0) {
    return <p className="text-muted-foreground text-sm">No hay lotes de escaneo todavía.</p>;
  }
  return (
    <div className="space-y-4">
      {batches.map((batch) => (
        <div key={batch.id} className="bg-card rounded-xl border p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <span className="bg-muted text-muted-foreground mr-2 rounded px-2 py-0.5 text-xs font-medium">
                {batch.kind === "bundle"
                  ? "Cuadernillo"
                  : batch.kind === "unclassified"
                    ? "Sin clasificar"
                    : "Formulación"}
              </span>
              <span className="font-medium">{batch.title ?? "(sin nombre)"}</span>
              <span className="text-muted-foreground ml-2 text-sm">
                {df.format(new Date(batch.createdAt))}
              </span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">
                {batch.processedSheets}/{batch.totalSheets} hojas
              </span>
              {batch.sinClasificar > 0 && (
                <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  {batch.sinClasificar} sin clasificar
                </span>
              )}
              <ScanStatusBadge status={batch.status} size="lg" />
              <DeleteBatchButton
                batchId={batch.id}
                shortId={batch.id.slice(0, 8)}
                // Los conteos se derivan acá mismo desde `sheets` y
                // `sinClasificar` — NO los propagamos por el interface
                // BatchForList para evitar churn en el shape.
                total={batch.sheets.length}
                calificadas={batch.sheets.filter((s) => s.status === "GRADED").length}
                sinClasificar={batch.sinClasificar}
              />
              <Link
                href={`/teacher/scan/${batch.id}`}
                className="text-primary font-medium hover:underline"
              >
                Revisar lote →
              </Link>
            </div>
          </div>

          {batch.sheets.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-lg border text-sm">
              <SheetsTable batchId={batch.id} sheets={batch.sheets} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
