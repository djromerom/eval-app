"use client";

import Link from "next/link";

import { DataTable, type Column } from "@/components/admin/data-table";
import { StatusBadge } from "@/components/evaluations/status-badge";
import type { EvaluationListItem } from "@/modules/evaluations/domain/evaluation";
import type { EvaluationStatus } from "@/modules/evaluations/domain/evaluation-status";

const df = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" });

/**
 * Orden de workflow explícito para la columna "Estado".
 *
 * Ago 2026 — pedido del docente: el sort por Estado debe seguir el flujo
 * de aprobación (DRAFT → IN_REVIEW → APPROVED → PUBLISHED), no el orden
 * alfabético del enum. Así un docente que quiera ver primero lo que aún
 * está en borrador lo tiene a un click.
 */
const WORKFLOW_ORDER: Record<EvaluationStatus, number> = {
  DRAFT: 0,
  IN_REVIEW: 1,
  APPROVED: 2,
  PUBLISHED: 3,
};
const workflowOrder = (a: EvaluationListItem, b: EvaluationListItem) =>
  WORKFLOW_ORDER[a.status] - WORKFLOW_ORDER[b.status];

/**
 * Wrapper client sobre `<DataTable>` para "Mis formulaciones".
 *
 * Por qué este archivo existe separado del page.tsx:
 * Next.js App Router NO permite pasar funciones (accessor / cell / sortFn)
 * desde un server component a un client component. Los column defs usan
 * funciones puras para resolver valores y renderizar celdas (Link,
 * StatusBadge, "—"), así que este archivo es `"use client"` y contiene
 * tanto las definiciones como el render del `<DataTable>`. El page.tsx
 * server solo le pasa `data` (array de EvaluationListItem), que sí es
 * serializable.
 */
export function EvaluationsTable({ data }: { data: EvaluationListItem[] }) {
  return (
    <DataTable<EvaluationListItem>
      data={data}
      columns={
        [
          {
            // Asignatura + grado concatenados (ago 2026): el docente pidió
            // ver '<subjectName> <courseName>' (courseName es el grado,
            // p.ej. '10-1') en lugar del título propio de la formulación.
            // El link al editor sigue siendo la fila, solo cambia lo que
            // se muestra.
            //
            // Ago 2026 — pedido del docente: esta columna queda
            // ALINEADA A LA IZQUIERDA. El resto de columnas se centran
            // (align: "center") — la Asignatura es la única referencia
            // textual que se lee de izquierda a derecha y debe arrancar
            // desde el margen para que el ojo del docente la encuentre
            // rápido al escanear la tabla.
            header: "Asignatura",
            accessor: (e) => `${e.subjectName} ${e.courseName}`,
            cell: (e) => (
              <Link
                href={`/teacher/evaluations/${e.id}/unified?from=list`}
                className="hover:underline"
              >
                {e.subjectName} {e.courseName}
              </Link>
            ),
            className: "px-4 py-3 font-medium",
          },
          {
            header: "Año",
            accessorKey: "academicYearYear",
            align: "center",
            className: "text-muted-foreground px-4 py-3",
          },
          {
            header: "Prueba",
            accessorKey: "periodName",
            align: "center",
            cell: (e) => e.periodName ?? "—",
            className: "text-muted-foreground px-4 py-3",
          },
          {
            header: "Tipo de cuadernillo",
            accessorKey: "bookletTypeName",
            align: "center",
            cell: (e) => e.bookletTypeName ?? "—",
            className: "text-muted-foreground px-4 py-3",
          },
          {
            header: "Estado",
            accessorKey: "status",
            align: "center",
            cell: (e) => <StatusBadge status={e.status} />,
            // Orden de workflow (no alfabético). Definido arriba en
            // `workflowOrder` para mantener el column def legible.
            sortFn: workflowOrder,
          },
          {
            header: "Ítems.",
            accessorKey: "totalQuestions",
            align: "center",
            className: "text-muted-foreground px-4 py-3",
          },
          {
            header: "Actualizada",
            accessorKey: "updatedAt",
            align: "center",
            cell: (e) => df.format(e.updatedAt),
            className: "text-muted-foreground px-4 py-3",
          },
        ] satisfies Column<EvaluationListItem>[]
      }
      emptyMessage="Aún no hay formulaciones."
      emptyColSpan={7}
      defaultSort={{ accessorKey: "updatedAt", direction: "desc" }}
      // CLASES ESPECÍFICAS DE ESTA TABLA — copiar textualmente del bloque
      // <table> original para no perder el visual que el docente validó:
      //   - wrapper con border-2 negro (más fuerte que el border de las
      //     tablas admin)
      //   - thead gris fuerte (slate-200 light / slate-700 dark) en lugar
      //     del bg-muted/40 del default
      //   - zebra striping con `odd:bg-white even:bg-muted/30`
      wrapperClassName="mt-8 overflow-x-auto rounded-xl border-2 border-black dark:border-white"
      theadClassName="text-foreground border-b-2 border-slate-300 bg-slate-200 text-left font-bold dark:border-slate-600 dark:bg-slate-700 dark:text-white"
      rowClassName="hover:bg-muted/30 even:bg-muted/30 border-b last:border-0 odd:bg-white"
    />
  );
}
