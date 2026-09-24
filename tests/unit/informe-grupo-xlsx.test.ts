/**
 * Excel del Informe detallado por grupo: se relee con exceljs y se verifican
 * título, línea Prueba/Grupo, encabezado combinado, estilos y valores.
 */
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  informeGrupoToXlsx,
  nombresDeHojaEstudiante,
} from "@/modules/consultas/domain/queries/informe-grupo/xlsx";
import type { InformeGrupo } from "@/modules/consultas/domain/queries/informe-grupo/informe-grupo";

const INFORME: InformeGrupo = {
  prueba: { id: "p1", name: "2026-2" },
  grupo: { id: "g1", name: "1001", courseName: "10" },
  cuadernillos: [{ id: "b1", name: "Cuadernillo 1" }],
  asignaturas: [
    { subjectId: "bio", etiqueta: "BIO", nombre: "Biología" },
    { subjectId: "fis", etiqueta: "FIS", nombre: "Física" },
  ],
  filas: [
    {
      item: 1,
      studentId: "e1",
      nombre: "Álvarez, Ana",
      codigo: "C1",
      puntajes: { bio: { puntaje: 8.5, correctas: 17, total: 20 }, fis: null },
    },
    {
      item: 3,
      studentId: "e3",
      nombre: "Castro, Luis",
      codigo: "C3",
      puntajes: {
        bio: { puntaje: 3, correctas: 1, total: 20 },
        fis: { puntaje: 10, correctas: 5, total: 5 },
      },
    },
  ],
};

async function libro(inf: InformeGrupo): Promise<ExcelJS.Workbook> {
  const buf = await informeGrupoToXlsx(inf);
  expect(buf.subarray(0, 2).toString()).toBe("PK"); // zip válido
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

async function leer(inf: InformeGrupo): Promise<ExcelJS.Worksheet> {
  return (await libro(inf)).worksheets[0]!;
}

describe("informeGrupoToXlsx", () => {
  it("escribe título, prueba y grupo", async () => {
    const ws = await leer(INFORME);
    expect(ws.getCell("A1").value).toBe("INFORME DETALLADO POR GRUPO");
    expect(ws.getCell("A1").font?.bold).toBe(true);
    expect(ws.getCell("A3").value).toBe("Prueba: 2026-2");
    expect(ws.getCell("C3").value).toBe("Grupo 1001");
  });

  it("encabezado de dos filas con ITEM/NOMBRE combinados y ASIGNATURAS sobre las siglas", async () => {
    const ws = await leer(INFORME);
    expect(ws.getCell("A4").value).toBe("ITEM");
    expect(ws.getCell("B4").value).toBe("NOMBRE");
    expect(ws.getCell("C4").value).toBe("ASIGNATURAS");
    expect(ws.getCell("C5").value).toBe("BIO");
    expect(ws.getCell("D5").value).toBe("FIS");
    // Celdas combinadas: A5 y D4 apuntan a su celda maestra.
    expect(ws.getCell("A5").master.address).toBe("A4");
    expect(ws.getCell("D4").master.address).toBe("C4");
    expect(ws.getCell("A1").isMerged).toBe(true);
  });

  it("el encabezado va en azul con texto blanco en negrita", async () => {
    const ws = await leer(INFORME);
    const c = ws.getCell("C5");
    expect(c.font?.bold).toBe(true);
    expect(c.font?.color?.argb).toBe("FFFFFFFF");
    expect(c.fill).toMatchObject({
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F6E9A" },
    });
  });

  it("una fila por estudiante con ITEM, nombre y puntajes; sin dato la celda queda vacía", async () => {
    const ws = await leer(INFORME);
    expect(ws.getCell("A6").value).toBe(1);
    expect(ws.getCell("B6").value).toBe("Álvarez, Ana");
    expect(ws.getCell("C6").value).toBe(8.5);
    expect(ws.getCell("C6").numFmt).toBe("0.0");
    expect(ws.getCell("D6").value).toBeNull();
    expect(ws.getCell("A7").value).toBe(3);
    expect(ws.getCell("D7").value).toBe(10);
  });

  it("sin asignaturas igual arma el bloque ASIGNATURAS", async () => {
    const ws = await leer({ ...INFORME, asignaturas: [], filas: [] });
    expect(ws.getCell("C4").value).toBe("ASIGNATURAS");
  });
});

describe("informeGrupoToXlsx - una hoja por estudiante", () => {
  it("el libro trae la hoja del grupo y una hoja por estudiante, en orden", async () => {
    const wb = await libro(INFORME);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Informe por grupo",
      "1. Álvarez, Ana",
      "3. Castro, Luis",
    ]);
  });

  it("cada hoja tiene el encabezado del estudiante y ITEM | ASIGNATURA | RESULTADO", async () => {
    const ws = (await libro(INFORME)).worksheets[2]!;
    expect(ws.getCell("A1").value).toBe("INFORME POR ESTUDIANTE");
    expect(ws.getCell("A3").value).toBe("Prueba: 2026-2");
    expect(ws.getCell("C3").value).toBe("GRUPO 1001");
    expect(ws.getCell("A4").value).toBe("Estudiante: Castro, Luis");
    expect(ws.getCell("C4").value).toBe("No. 3");
    expect([1, 2, 3].map((c) => ws.getCell(5, c).value)).toEqual([
      "ITEM",
      "ASIGNATURA",
      "RESULTADO",
    ]);
    expect(ws.getCell("B5").fill).toMatchObject({ fgColor: { argb: "FF1F6E9A" } });
  });

  it("una fila por asignatura con el nombre completo y su resultado; sin dato, vacía", async () => {
    const wb = await libro(INFORME);
    const ana = wb.worksheets[1]!;
    expect([ana.getCell("A6").value, ana.getCell("B6").value, ana.getCell("C6").value]).toEqual([
      1,
      "Biología",
      8.5,
    ]);
    expect([ana.getCell("A7").value, ana.getCell("B7").value]).toEqual([2, "Física"]);
    expect(ana.getCell("C7").value).toBeNull();
    expect(ana.getCell("C6").numFmt).toBe("0.0");
    expect(wb.worksheets[2]!.getCell("C7").value).toBe(10);
  });

  it("sin estudiantes, solo la hoja del grupo", async () => {
    const wb = await libro({ ...INFORME, filas: [] });
    expect(wb.worksheets).toHaveLength(1);
  });
});

describe("nombresDeHojaEstudiante", () => {
  const fila = (item: number | null, nombre: string) => ({
    item,
    studentId: nombre,
    nombre,
    codigo: "",
    puntajes: {},
  });

  it("recorta a 31 caracteres (límite de Excel)", () => {
    const [n] = nombresDeHojaEstudiante([fila(12, "RODRIGUEZ MONTENEGRO, MARIA ALEJANDRA")]);
    expect(n!.length).toBeLessThanOrEqual(31);
    expect(n!.startsWith("12. RODRIGUEZ")).toBe(true);
  });

  it("quita los caracteres que Excel no admite", () => {
    const [n] = nombresDeHojaEstudiante([fila(1, "A/B: [C]*?\\D")]);
    expect(n).not.toMatch(/[[\]:*?/\\]/);
  });

  it("desambigua nombres que quedan iguales al recortar", () => {
    const largo = "RODRIGUEZ MONTENEGRO, MARIA ALEJANDRA";
    const nombres = nombresDeHojaEstudiante([fila(1, largo), fila(1, largo)]);
    expect(new Set(nombres.map((x) => x.toLowerCase())).size).toBe(2);
    for (const x of nombres) expect(x.length).toBeLessThanOrEqual(31);
  });

  it("sin ITEM usa la posición", () => {
    expect(nombresDeHojaEstudiante([fila(null, "Pérez, Juan")])).toEqual(["1. Pérez, Juan"]);
  });
});
