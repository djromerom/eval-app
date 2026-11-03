/**
 * Tests del formatter puro `formulacionRowsToWorksheet`. Sin Next, sin BD.
 *
 * SheetJS no expone un parse inverso trivial para verificar el contenido
 * exacto; en su lugar verificamos:
 *  1. La salida es un Buffer no-vacío con magic header "PK" (xlsx = zip).
 *  2. Los `headers` y el `row count` cuadran re-serializando el workbook.
 *  3. Casos de borde conocidos (assignedTeachers[], expected null, fechas).
 */
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import type { FormulacionRow } from "@/modules/consultas/domain/queries/formulaciones/formulacion-row";
import type { AsignacionPendiente } from "@/modules/consultas/domain/queries/formulaciones/asignacion-pendiente";
import { formulacionRowsToWorksheet } from "@/modules/consultas/domain/shared/xlsx-formatter";

function makeRow(overrides: Partial<FormulacionRow> = {}): FormulacionRow {
  return {
    id: "ev-1",
    title: "Formulación Demo",
    subjectName: "Matemáticas",
    courseName: "10-1",
    academicYearYear: 2026,
    periodId: "p-1",
    periodName: "Periodo 1",
    bookletTypeId: "bt-1",
    bookletTypeName: "Estándar",
    status: "DRAFT",
    authorName: "María López",
    assignedTeachers: ["María López", "Carlos Ruiz"],
    itemsTotal: 20,
    itemsExpected: 20,
    itemsBadge: "ok",
    updatedAt: new Date("2026-09-03T12:00:00Z"),
    ...overrides,
  };
}

function makePendiente(overrides: Partial<AsignacionPendiente> = {}): AsignacionPendiente {
  return {
    id: "rule-1",
    subjectName: "Inglés",
    courseName: "10",
    academicYearYear: 2026,
    periodId: "p-1",
    periodName: "Periodo 1",
    bookletTypeId: "bt-2",
    bookletTypeName: "Con Ajuste",
    itemsExpected: 25,
    assignedTeachers: ["Ana Ruiz"],
    ...overrides,
  };
}

describe("formulacionRowsToWorksheet", () => {
  it("devuelve un Buffer no-vacío con magic header PK (xlsx = zip)", () => {
    const buf = formulacionRowsToWorksheet([makeRow()]);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    // ZIP/XLSX empieza con "PK" (0x50 0x4B).
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it("serializa exactamente 1 fila cuando recibe 1 row (1 header + 1 row)", () => {
    const buf = formulacionRowsToWorksheet([makeRow()]);
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1 });
    expect(rows).toHaveLength(2); // header + 1 row
  });

  it("el header contiene los 12 títulos canónicos en orden", () => {
    const buf = formulacionRowsToWorksheet([]);
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    const [header] = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1 });
    expect(header).toEqual([
      "Asignatura",
      "Grado",
      "Año Académico",
      "Prueba",
      "Tipo de Cuadernillo",
      "Estado",
      "Items Total",
      "Items Esperado",
      "Items Estado",
      "Docentes Asignados",
      "Docente Formulador",
      "Última Actualización",
    ]);
  });

  it("assignedTeachers[] se serializa como string con join ', '", () => {
    const buf = formulacionRowsToWorksheet([makeRow({ assignedTeachers: ["A", "B", "C"] })]);
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    const [, data = []] = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
    expect(data[9]).toBe("A, B, C");
    expect(data[10]).toBe("María López"); // docente formulador
  });

  it("assignedTeachers vacío → celda vacía", () => {
    const buf = formulacionRowsToWorksheet([makeRow({ assignedTeachers: [] })]);
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    const [, data = []] = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
    expect(data[9]).toBe("");
  });

  it("itemsExpected null → celda vacía + Estado Sin regla", () => {
    const buf = formulacionRowsToWorksheet([makeRow({ itemsExpected: null, itemsBadge: "none" })]);
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    const [, data = []] = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1 });
    expect(data[7]).toBe(""); // esperado vacío (null → cell vacío)
    expect(data[8]).toBe("Sin regla");
  });

  it("itemsBadge 'low' (faltan) → 'Faltan'", () => {
    const buf = formulacionRowsToWorksheet([
      makeRow({ itemsTotal: 8, itemsExpected: 10, itemsBadge: "low" }),
    ]);
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    const [, data = []] = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1 });
    expect(data[8]).toBe("Faltan");
  });

  it("itemsBadge 'high' (sobran) → 'Sobran'", () => {
    const buf = formulacionRowsToWorksheet([
      makeRow({ itemsTotal: 25, itemsExpected: 20, itemsBadge: "high" }),
    ]);
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    const [, data = []] = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1 });
    expect(data[8]).toBe("Sobran");
  });

  it("updatedAt se serializa como ISO 8601", () => {
    const ts = new Date("2026-09-03T15:30:00.000Z");
    const buf = formulacionRowsToWorksheet([makeRow({ updatedAt: ts })]);
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    const [, data = []] = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
    expect(data[11]).toBe("2026-09-03T15:30:00.000Z");
  });

  it("listado vacío → workbook solo con headers", () => {
    const buf = formulacionRowsToWorksheet([]);
    const wb = XLSX.read(buf, { type: "buffer" });
    expect(wb.SheetNames).toContain("Formulaciones");
    const sheet = wb.Sheets["Formulaciones"]!;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    expect(rows).toHaveLength(1); // solo header
  });

  it("las asignaciones pendientes se exportan al final de las formulaciones", () => {
    const buf = formulacionRowsToWorksheet([makeRow()], [makePendiente()]);
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1 });
    expect(rows).toHaveLength(3); // header + 1 formulating + 1 pendiente
    expect(rows[2]?.[0]).toBe("Inglés");
    expect(rows[2]?.[1]).toBe("10");
  });

  it("la asignación pendiente deja vacías las celdas que no aplican", () => {
    const buf = formulacionRowsToWorksheet([], [makePendiente()]);
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    const [, data = []] = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1 });
    expect(data[5]).toBe("Sin formular"); // Estado: todavía no hay formulación
    expect(data[6]).toBe(0); // Items Total
    expect(data[7]).toBe(25); // Items Esperado (la regla de conteo)
    expect(data[8]).toBe("Faltan"); // Items Estado
    expect(data[9]).toBe("Ana Ruiz"); // Docentes Asignados
    expect(data[10]).toBe(""); // Docente Formulador (no hay formulación)
    expect(data[11]).toBe(""); // Última Actualización
  });
});
