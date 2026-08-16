"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowDownUp, ArrowUp } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  sortRows,
  type SortDirection,
  type SortState,
  type SortableColumn,
} from "./data-table-sort";

/** Definición de una columna de la tabla. */
export interface Column<T> extends SortableColumn<T> {
  /** Texto del encabezado — VERBATIM del original (no se toca copy). */
  header: string;
  /** Render personalizado de la celda. Si está, gana sobre el default
   *  `String(accessor/accessorKey)`. */
  cell?: (row: T) => React.ReactNode;
  /** `false` desactiva el ordenamiento en esta columna (botones no son
   *  data — no tiene sentido ordenarlos). Default: `true` salvo que la
   *  columna no tenga accessorKey ni accessor (puramente decorativa). */
  sortable?: boolean;
  /** Clases aplicadas tanto al `<th>` como a los `<td>` de la columna. */
  className?: string;
  /** Clases adicionales SOLO en el `<th>` (p.ej. alinear a la derecha). */
  headerClassName?: string;
}

export interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  emptyMessage: string;
  emptyColSpan: number;
  defaultSort?: { accessorKey: keyof T; direction: SortDirection };
  rowKey?: (row: T) => string;
  /** Escape hatch para tablas con styling único (caso `teacher/evaluations`
   *  que tiene border-2 negro, thead gris fuerte, zebra striping). El
   *  default apunta al fingerprint de las tablas admin (institutions/
   *  teachers/users/bundles). */
  wrapperClassName?: string;
  theadClassName?: string;
  /** Clases de cada `<tr>` del body. */
  rowClassName?: string;
}

/** Resuelve el identificador del accesor de una columna: `accessorKey` si
 *  está, si no `header`. El helper `sortRows` lo usa para matchear contra
 *  `sort.accessor`. Lo separamos del componente para poder exportarlo
 *  al .ts si hace falta mockear en tests. */
function getAccessorKey<T>(c: SortableColumn<T>): string {
  return (c.accessorKey as string | undefined) ?? c.header;
}

function isSortable<T>(c: Column<T>): boolean {
  if (c.sortable === false) return false;
  if (c.sortable === true) return true;
  // default: sort-able si tiene accessorKey, accessor O sortFn
  return Boolean(c.accessorKey || c.accessor || c.sortFn);
}

/** Indicador visual del estado de sort de una columna. */
function SortIcon({ active, direction }: { active: boolean; direction: SortDirection | null }) {
  if (!active) {
    return <ArrowDownUp className="text-muted-foreground/60 h-3.5 w-3.5" aria-hidden />;
  }
  if (direction === "asc") {
    return <ArrowUp className="text-foreground h-3.5 w-3.5" aria-hidden />;
  }
  return <ArrowDown className="text-foreground h-3.5 w-3.5" aria-hidden />;
}

/**
 * `<DataTable<T>>` — primitivo genérico de tabla con ordenamiento por columna.
 *
 * Ago 2026 — primer commit del sprint "Tabla ordenable".
 *
 * Reglas inquebrantables:
 * 1. No se modifica la copy visible: `header`, `emptyMessage`, `cell` se
 *    consumen tal cual vienen del caller.
 * 2. No se reescribe código del docente: si el caller mete JSX propio en
 *    `cell`, se renderiza verbatim.
 * 3. El sort cycle es asc → desc → null (3 estados). El estado inicial es
 *    `defaultSort` si se pasa.
 *
 * @example
 *   <DataTable
 *     data={evaluations}
 *     columns={[...]}
 *     emptyMessage="Aún no hay formulaciones."
 *     emptyColSpan={7}
 *     defaultSort={{ accessorKey: "updatedAt", direction: "desc" }}
 *   />
 */
export function DataTable<T>({
  data,
  columns,
  emptyMessage,
  emptyColSpan,
  defaultSort,
  rowKey,
  wrapperClassName = "overflow-x-auto rounded-xl border",
  theadClassName = "bg-muted/40 text-muted-foreground border-b text-left",
  rowClassName = "border-b last:border-0",
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState | null>(() => {
    if (!defaultSort) return null;
    const targetKey = String(defaultSort.accessorKey);
    const col = columns.find((c) => (c.accessorKey as string | undefined) === targetKey);
    return {
      accessor: col ? (col.accessorKey as string) : targetKey,
      direction: defaultSort.direction,
    };
  });

  const sorted = useMemo(
    () => sortRows(data, columns, sort, getAccessorKey),
    [data, columns, sort],
  );

  const handleHeaderClick = (col: Column<T>) => {
    if (!isSortable(col)) return;
    const key = getAccessorKey(col);
    setSort((prev) => {
      if (!prev || prev.accessor !== key) {
        return { accessor: key, direction: "asc" };
      }
      if (prev.direction === "asc") {
        return { accessor: key, direction: "desc" };
      }
      return null; // tercer click: reset
    });
  };

  const resolveKey = (row: T, idx: number): string => {
    if (rowKey) return rowKey(row);
    const r = row as unknown as { id?: unknown };
    if (r && r.id !== undefined && r.id !== null) return String(r.id);
    return String(idx);
  };

  /** Default `cell` cuando no hay render custom: valor resuelto por accessor
   *  (fn > key) y serializado a string. `undefined`/`null` → vacío. */
  const defaultCellValue = (row: T, col: Column<T>): string => {
    const v = col.accessor ? col.accessor(row) : col.accessorKey ? row[col.accessorKey] : undefined;
    if (v === null || v === undefined) return "";
    return String(v);
  };

  return (
    <div className={wrapperClassName}>
      <table className="w-full text-sm">
        <thead className={theadClassName}>
          <tr>
            {columns.map((col) => {
              const sortable = isSortable(col);
              const key = getAccessorKey(col);
              const active = sort?.accessor === key;
              const ariaSort: "ascending" | "descending" | "none" = active
                ? sort?.direction === "asc"
                  ? "ascending"
                  : "descending"
                : "none";
              return (
                <th
                  key={col.header}
                  scope="col"
                  aria-sort={ariaSort}
                  className={cn("px-4 py-3 font-medium", col.headerClassName ?? col.className)}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => handleHeaderClick(col)}
                      aria-label={`Ordenar por ${col.header}`}
                      // hover:bg-muted/60 explicita el affordance "clickeable"
                      // cuando el docente pasa el mouse — sin esto el <th>
                      // no muestra nada que diga "esto ordena la columna".
                      className="hover:bg-muted/60 -mx-1 flex w-full cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-left font-medium transition-colors"
                    >
                      <span>{col.header}</span>
                      <SortIcon
                        active={active}
                        direction={active ? (sort?.direction ?? null) : null}
                      />
                    </button>
                  ) : (
                    <span>{col.header}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={emptyColSpan} className="text-muted-foreground px-4 py-8 text-center">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            sorted.map((row, idx) => (
              <tr key={resolveKey(row, idx)} className={rowClassName}>
                {columns.map((col) => (
                  <td key={col.header} className={cn("px-4 py-3", col.className)}>
                    {col.cell ? col.cell(row) : defaultCellValue(row, col)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
