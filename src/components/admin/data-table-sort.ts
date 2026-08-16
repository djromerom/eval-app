/**
 * Lógica pura (sin React) para ordenamiento de columnas.
 * Vive en archivo hermano de `data-table.tsx` para que pueda unit-testearse
 * con `environment: "node"` (vitest del proyecto, sin DOM).
 *
 * Por qué el collator usa `sensitivity: "base"` + `numeric: true`:
 *   - "base" trata como iguales caracteres con/sin tilde y "ñ" ≈ "n" — la
 *     forma en que un docente colombiano ordena naturalmente.
 *   - `numeric: true` hace que "Item 2" < "Item 10" en orden natural (no
 *     lexicográfico puro). Aplica a columnas derivadas tipo "10-1", "2-1".
 *
 * Ago 2026 — primer commit del sprint "Tabla ordenable".
 */

export type SortDirection = "asc" | "desc";

export interface SortState {
  accessor: string;
  direction: SortDirection;
}

/** Forma mínima de columna que `sortRows` necesita. La interfaz `Column<T>`
 *  completa (con `cell`, `sortable`, etc.) vive en `data-table.tsx`. */
export interface SortableColumn<T> {
  accessorKey?: keyof T;
  accessor?: (row: T) => unknown;
  sortFn?: (a: T, b: T) => number;
  header: string;
}

const COLLATOR = new Intl.Collator("es", { sensitivity: "base", numeric: true });

/**
 * Compara dos valores cualesquiera retornando un número con la convención de
 * `Array.sort`: negativo si `a < b`, positivo si `a > b`, 0 si iguales.
 *
 * Reglas:
 *   - `null`/`undefined` van al FINAL en ascendente, al INICIO en descendente.
 *     Esto es intencional y consistente con que las celdas vacías rendericen
 *     `—` (el docente espera ver los datos "reales" primero, los vacíos al
 *     final de la lista).
 *   - `Date` se compara por `getTime()`.
 *   - `number` se compara numéricamente, no lexicográficamente (`10 > 2`).
 *   - `boolean` se trata como 0/1 (false < true).
 *   - resto se serializa con el collator español.
 */
export function compareCell(a: unknown, b: unknown): number {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") {
    return (a ? 1 : 0) - (b ? 1 : 0);
  }
  return COLLATOR.compare(String(a), String(b));
}

/**
 * Ordena `rows` según la `SortState` indicada.
 *
 * - `sort === null` → devuelve `rows` tal cual (referencia, no copia).
 * - `accessorKeyOf(c)` resuelve el identificador del accesor de la columna
 *   (en la práctica `getAccessorKey(c)` del .tsx — se inyecta para mantener
 *   este archivo sin React y sin saber nada de `Column<T>`).
 * - Si la columna tiene `sortFn` propio, se usa ese (omite `compareCell`).
 * - Si no, se resuelve el valor con `accessor(a) ?? accessorKey` y se delega
 *   a `compareCell`.
 * - `direction === "desc"` invierte el array resultante. (Array.sort no tiene
 *   un flag estable e integración nativo para desc, así que invertimos al
 *   final — el costo es O(n) extra que para tablas <500 filas es despreciable).
 *
 * Devuelve una copia (`[...rows]`) cuando hay sort activo, para no mutar
 * la referencia original del caller. Cuando `sort === null`, devuelve la
 * misma referencia (atajo que ahorra una copia por cada render sin sort).
 */
export function sortRows<T>(
  rows: T[],
  columns: SortableColumn<T>[],
  sort: SortState | null,
  accessorKeyOf: (col: SortableColumn<T>) => string,
): T[] {
  if (!sort) return rows;
  const col = columns.find((c) => accessorKeyOf(c) === sort.accessor);
  if (!col) return rows;
  const arr = [...rows];
  arr.sort((a, b) => {
    if (col.sortFn) return col.sortFn(a, b);
    const va = col.accessor ? col.accessor(a) : col.accessorKey ? a[col.accessorKey] : undefined;
    const vb = col.accessor ? col.accessor(b) : col.accessorKey ? b[col.accessorKey] : undefined;
    return compareCell(va, vb);
  });
  if (sort.direction === "desc") arr.reverse();
  return arr;
}
