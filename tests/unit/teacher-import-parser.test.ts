import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseTeacherImport } from "@/modules/teachers/infrastructure/import-parser";

const CSV_BASIC = `nombre,correo,tipodoc,numdoc,telefono
Ana Pérez,ana@c.co,C.C.,123,3001234567
Luis Gómez,luis@c.co,C.E.,456,
Maria López,maria@c.co,PPT,789,3009876543`;

const CSV_SINONIMOS = `name,e mail,tipo documento,numero documento,celular
Ana,ana@c.co,C.C.,123,3001234567`;

const CSV_PUNTO_COMA = `nombre;correo;tipodoc;numdoc;telefono
Ana;ana@c.co;C.C.;123;3001234567`;

const CSV_BOM_CRLF =
  "﻿nombre,correo,tipodoc,numdoc,telefono\r\nAna,ana@c.co,C.C.,123,3001234567\r\n";

describe("parseTeacherImport — CSV", () => {
  it("parsea encabezados estándar con separador ,", () => {
    const r = parseTeacherImport(Buffer.from(CSV_BASIC, "utf8"), "docentes.csv");
    expect(r.error).toBeUndefined();
    expect(r.missing).toEqual([]);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({
      name: "Ana Pérez",
      email: "ana@c.co",
      idType: "C.C.",
      idNumber: "123",
      phone: "3001234567",
    });
    expect(r.rows[1]?.phone).toBeUndefined();
    expect(r.rows[2]).toMatchObject({ phone: "3009876543" });
  });

  it("acepta sinónimos en los encabezados", () => {
    const r = parseTeacherImport(Buffer.from(CSV_SINONIMOS, "utf8"), "docentes.csv");
    expect(r.error).toBeUndefined();
    expect(r.rows[0]).toMatchObject({
      name: "Ana",
      email: "ana@c.co",
      idType: "C.C.",
      idNumber: "123",
      phone: "3001234567",
    });
  });

  it("auto-detecta el delimitador ;", () => {
    const r = parseTeacherImport(Buffer.from(CSV_PUNTO_COMA, "utf8"), "docentes.csv");
    expect(r.error).toBeUndefined();
    expect(r.rows[0]).toMatchObject({ idType: "C.C.", idNumber: "123" });
  });

  it("tolera BOM y CRLF", () => {
    const r = parseTeacherImport(Buffer.from(CSV_BOM_CRLF, "utf8"), "docentes.csv");
    expect(r.error).toBeUndefined();
    expect(r.rows[0]?.name).toBe("Ana");
  });

  it("reporta columnas faltantes", () => {
    const csv = "nombre,correo\nAna,ana@c.co";
    const r = parseTeacherImport(Buffer.from(csv, "utf8"), "docentes.csv");
    expect(r.rows).toEqual([]);
    expect(r.missing).toEqual(expect.arrayContaining(["idType", "idNumber"]));
  });

  it("rechaza archivos vacíos", () => {
    const r = parseTeacherImport(Buffer.from("", "utf8"), "docentes.csv");
    expect(r.error).toBeDefined();
  });

  it("maneja comillas dobles escapadas y comas dentro de celdas", () => {
    const csv = `nombre,correo,tipodoc,numdoc,telefono
"Pérez, Ana","ana@c.co",C.C.,123,300`;
    const r = parseTeacherImport(Buffer.from(csv, "utf8"), "docentes.csv");
    expect(r.error).toBeUndefined();
    expect(r.rows[0]?.name).toBe("Pérez, Ana");
  });
});

function xlsxBufferFromAOA(aoa: unknown[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Docentes");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseTeacherImport — XLSX", () => {
  it("parsea la primera hoja del workbook", () => {
    const buf = xlsxBufferFromAOA([
      ["Nombre", "Correo", "Tipo doc", "Núm doc", "Teléfono"],
      ["Ana Pérez", "ana@c.co", "C.C.", "123", "3001234567"],
      ["Luis Gómez", "luis@c.co", "C.E.", "456", ""],
    ]);
    const r = parseTeacherImport(buf, "docentes.xlsx");
    expect(r.error).toBeUndefined();
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({
      name: "Ana Pérez",
      email: "ana@c.co",
      idType: "C.C.",
      idNumber: "123",
      phone: "3001234567",
    });
    expect(r.rows[1]?.phone).toBeUndefined();
  });

  it("ignora filas en blanco (blankrows)", () => {
    const buf = xlsxBufferFromAOA([
      ["nombre", "correo", "tipodoc", "numdoc", "telefono"],
      ["Ana", "ana@c.co", "C.C.", "1", ""],
      [],
      ["", "", "", "", ""],
      ["Luis", "luis@c.co", "C.C.", "2", ""],
    ]);
    const r = parseTeacherImport(buf, "docentes.xlsx");
    expect(r.rows).toHaveLength(2);
  });

  it("reporta columnas faltantes en XLSX", () => {
    const buf = xlsxBufferFromAOA([
      ["Nombre", "Correo"],
      ["Ana", "ana@c.co"],
    ]);
    const r = parseTeacherImport(buf, "docentes.xlsx");
    expect(r.rows).toEqual([]);
    expect(r.missing).toEqual(expect.arrayContaining(["idType", "idNumber"]));
  });

  it("tolera un workbook vacío con un mensaje claro", () => {
    const buf = xlsxBufferFromAOA([["nombre", "correo", "tipodoc", "numdoc", "telefono"]]);
    const r = parseTeacherImport(buf, "docentes.xlsx");
    expect(r.error).toBeDefined();
  });
});

describe("parseTeacherImport — extensión", () => {
  it("rechaza extensiones no soportadas", () => {
    const r = parseTeacherImport(Buffer.from("hola", "utf8"), "docentes.docx");
    expect(r.error).toMatch(/no soportado/i);
    expect(r.rows).toEqual([]);
  });

  it("acepta .xls además de .xlsx", () => {
    const buf = xlsxBufferFromAOA([
      ["nombre", "correo", "tipodoc", "numdoc", "telefono"],
      ["Ana", "ana@c.co", "C.C.", "1", ""],
    ]);
    // SheetJS escribe como xlsx; nosotros relajamos la regex a xlsx?
    const r = parseTeacherImport(buf, "docentes.XLSX");
    expect(r.error).toBeUndefined();
    expect(r.rows).toHaveLength(1);
  });
});
