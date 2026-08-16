import { describe, expect, it } from "vitest";

import { compareCell, sortRows, type SortableColumn } from "@/components/admin/data-table-sort";

const accessorKey = <T>(c: SortableColumn<T>): string =>
  (c.accessorKey as string | undefined) ?? c.header;

interface Row {
  id: string;
  name?: string | null;
  count?: number | null;
  when?: Date | null;
  priority?: number;
  flag?: boolean;
}

const cols: SortableColumn<Row>[] = [
  { accessorKey: "id", header: "ID" },
  { accessorKey: "name", header: "Nombre" },
  { accessorKey: "count", header: "Cantidad" },
  { accessorKey: "when", header: "Fecha" },
  { accessorKey: "priority", header: "Prioridad" },
  { accessorKey: "flag", header: "Activo" },
];

describe("compareCell", () => {
  it("ignora case y tildes en strings (Intl.Collator 'es' con sensitivity: 'base')", () => {
    // "Álvarez" y "Alvarez" son iguales — la tilde no pesa en el orden.
    expect(compareCell("Alvarez", "Álvarez")).toBe(0);
    // "NIÑO" y "Niño" son iguales — case insensitive.
    expect(compareCell("NIÑO", "Niño")).toBe(0);
  });

  it("ñ es letra distinta de n (orden alfabético español)", () => {
    // La ñ SÍ se trata como letra propia — viene después de la n en el
    // alfabeto. Eso es la regla del docente colombiano y la del DEE, así
    // que la conservamos.
    expect(compareCell("Niño", "Nina")).toBeGreaterThan(0);
  });

  it("ordena números como números, no lexicográficamente", () => {
    // Lexicográfico: "10" < "2" → sería -1. Numérico: 10 > 2 → +1.
    expect(compareCell(10, 2)).toBeGreaterThan(0);
    expect(compareCell(2, 10)).toBeLessThan(0);
    expect(compareCell(7, 7)).toBe(0);
  });

  it("ordena fechas por getTime", () => {
    const a = new Date("2026-01-01T00:00:00Z");
    const b = new Date("2026-08-16T00:00:00Z");
    expect(compareCell(a, b)).toBeLessThan(0);
    expect(compareCell(b, a)).toBeGreaterThan(0);
    expect(compareCell(a, new Date(a.getTime()))).toBe(0);
  });

  it("null/undefined van al final en ascendente", () => {
    expect(compareCell(null, "x")).toBeGreaterThan(0);
    expect(compareCell(undefined, "x")).toBeGreaterThan(0);
    expect(compareCell(null, null)).toBe(0);
    expect(compareCell(null, undefined)).toBe(0);
  });

  it("booleanos se tratan como 0/1 (false < true)", () => {
    expect(compareCell(false, true)).toBeLessThan(0);
    expect(compareCell(true, false)).toBeGreaterThan(0);
    expect(compareCell(true, true)).toBe(0);
  });

  it("mezcla null con número: null al final", () => {
    expect(compareCell(null, 5)).toBeGreaterThan(0);
    expect(compareCell(5, null)).toBeLessThan(0);
    expect(compareCell(null, 0)).toBeGreaterThan(0);
  });
});

describe("sortRows", () => {
  const data: Row[] = [
    { id: "1", name: "Carlos", count: 10, when: new Date("2026-01-15") },
    { id: "2", name: "ana", count: 2, when: new Date("2026-08-01") },
    { id: "3", name: "Beatriz", count: 1, when: null },
    { id: "4", name: "ana", count: 5, when: new Date("2026-03-10") },
  ];

  it("sort === null devuelve rows tal cual (misma referencia)", () => {
    const result = sortRows(data, cols, null, accessorKey);
    expect(result).toBe(data);
  });

  it("ordena strings ascendente y respeta acentos/case-insensitive", () => {
    const result = sortRows(data, cols, { accessor: "name", direction: "asc" }, accessorKey);
    expect(result.map((r) => r.name)).toEqual(["ana", "ana", "Beatriz", "Carlos"]);
  });

  it("ordena strings descendente", () => {
    const result = sortRows(data, cols, { accessor: "name", direction: "desc" }, accessorKey);
    expect(result.map((r) => r.name)).toEqual(["Carlos", "Beatriz", "ana", "ana"]);
  });

  it("ordena números ascendente (no lexicográfico)", () => {
    // El orden del input es [10, 2, 1, 5]; si fuera lexicográfico sería
    // [1, 10, 2, 5]. Numérico correcto: [1, 2, 5, 10].
    const result = sortRows(data, cols, { accessor: "count", direction: "asc" }, accessorKey);
    expect(result.map((r) => r.count)).toEqual([1, 2, 5, 10]);
  });

  it("ordena fechas ascendente; null al final", () => {
    const result = sortRows(data, cols, { accessor: "when", direction: "asc" }, accessorKey);
    // Fechas: 2026-01-15, 2026-03-10, 2026-08-01, luego null
    expect(result.map((r) => r.id)).toEqual(["1", "4", "2", "3"]);
  });

  it("sort estable: filas con misma key conservan orden de inserción", () => {
    // Hay dos filas con name="ana" (ids 2 y 4). En ascendente deben quedar
    // en el mismo orden en que estaban en el array original.
    const result = sortRows(data, cols, { accessor: "name", direction: "asc" }, accessorKey);
    const anas = result.filter((r) => r.name === "ana").map((r) => r.id);
    expect(anas).toEqual(["2", "4"]);
  });

  it("sortFn custom ignora compareCell", () => {
    // Columna derivada (sin accessorKey, accessor + header único). El
    // sortFn ordena descendente por prioridad (mayor primero). Con
    // direction: 'asc' la inversión final NO se aplica y sortRows respeta
    // exactamente lo que el sortFn produjo.
    const localCols: SortableColumn<Row>[] = [
      ...cols,
      {
        header: "PriorityCustom",
        accessor: (r) => r.priority ?? 0,
        sortFn: (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
      },
    ];
    const input: Row[] = [
      { id: "x", priority: 1 },
      { id: "y", priority: 3 },
      { id: "z", priority: 2 },
    ];
    const result = sortRows(
      input,
      localCols,
      { accessor: "PriorityCustom", direction: "asc" },
      accessorKey,
    );
    expect(result.map((r) => r.priority)).toEqual([3, 2, 1]);
  });

  it("accessor derivado ordena por el valor resuelto", () => {
    // Columna "FullName" derivada: la usamos para validar que un accessor
    // tipo fn se evalúa antes del compareCell.
    const localCols: SortableColumn<Row>[] = [
      ...cols,
      {
        header: "FullName",
        accessor: (r) => (r.name ?? "") + r.id, // distinto por id cuando name coincide
      },
    ];
    const result = sortRows(
      data,
      localCols,
      { accessor: "FullName", direction: "asc" },
      accessorKey,
    );
    // anas quedan por id ascendente (ana2, ana4), luego Beatriz, luego Carlos.
    expect(result.map((r) => r.id)).toEqual(["2", "4", "3", "1"]);
  });

  it("sort === { accessor inexistente } devuelve rows sin tirar", () => {
    const result = sortRows(data, cols, { accessor: "noExiste", direction: "asc" }, accessorKey);
    expect(result).toBe(data);
  });
});
