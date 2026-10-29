/**
 * Excel del Informe detallado por grupo, con el formato de las planillas
 * institucionales:
 *
 *   1. Hoja "Informe por grupo": título, línea Prueba/Grupo y encabezado de
 *      dos filas (ITEM y NOMBRE combinados en vertical, "ASIGNATURAS"
 *      combinado sobre las columnas de asignatura y las siglas debajo).
 *   2. Una hoja por estudiante ("INFORME POR ESTUDIANTE"): Prueba/GRUPO,
 *      Estudiante/No. y la tabla ITEM | ASIGNATURA | RESULTADO, con las
 *      asignaturas en el mismo orden que las columnas del grupo.
 *
 * Encabezados con fondo azul y texto blanco en negrita. Usa exceljs y no
 * SheetJS (el que exporta formulaciones) porque la edición Community de
 * SheetJS no escribe estilos. Función pura (sin BD); la regla de capas solo
 * prohíbe `@prisma/client`.
 */
import ExcelJS from "exceljs";
import type { FilaInformeGrupo, InformeGrupo } from "./informe-grupo";

const AZUL = "FF1F6E9A";
const BLANCO = "FFFFFFFF";
const HOJA_GRUPO = "Informe por grupo";

const borde: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};

function estiloEncabezado(cell: ExcelJS.Cell): void {
  cell.font = { bold: true, color: { argb: BLANCO } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } };
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  cell.border = borde;
}

function hojaGrupo(wb: ExcelJS.Workbook, informe: InformeGrupo): void {
  const FILA_TITULO = 1;
  const FILA_DATOS_GRUPO = 3;
  const FILA_ENCABEZADO = 4; // ITEM / NOMBRE / ASIGNATURAS
  const FILA_SIGLAS = 5;
  const PRIMERA_FILA_DATOS = 6;

  const ws = wb.addWorksheet(HOJA_GRUPO, {
    views: [{ state: "frozen", xSplit: 2, ySplit: FILA_SIGLAS }],
  });

  // Al menos una columna de asignaturas, para que el bloque exista aunque el
  // grado no tenga cuadernillos en la prueba.
  const nAsig = Math.max(informe.asignaturas.length, 1);
  const ultimaCol = 2 + nAsig;

  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 40;
  for (let c = 3; c <= ultimaCol; c++) ws.getColumn(c).width = 9;

  ws.mergeCells(FILA_TITULO, 1, FILA_TITULO, ultimaCol);
  const titulo = ws.getCell(FILA_TITULO, 1);
  titulo.value = "INFORME DETALLADO POR GRUPO";
  titulo.font = { bold: true, size: 14 };
  titulo.alignment = { horizontal: "center" };

  ws.getCell(FILA_DATOS_GRUPO, 1).value = `Prueba: ${informe.prueba.name}`;
  ws.getCell(FILA_DATOS_GRUPO, 3).value = `Grupo ${informe.grupo.name}`;

  ws.mergeCells(FILA_ENCABEZADO, 1, FILA_SIGLAS, 1);
  ws.getCell(FILA_ENCABEZADO, 1).value = "ITEM";
  ws.mergeCells(FILA_ENCABEZADO, 2, FILA_SIGLAS, 2);
  ws.getCell(FILA_ENCABEZADO, 2).value = "NOMBRE";
  if (nAsig > 1) ws.mergeCells(FILA_ENCABEZADO, 3, FILA_ENCABEZADO, ultimaCol);
  ws.getCell(FILA_ENCABEZADO, 3).value = "ASIGNATURAS";
  informe.asignaturas.forEach((a, i) => {
    ws.getCell(FILA_SIGLAS, 3 + i).value = a.etiqueta;
  });
  for (let c = 1; c <= ultimaCol; c++) {
    estiloEncabezado(ws.getCell(FILA_ENCABEZADO, c));
    estiloEncabezado(ws.getCell(FILA_SIGLAS, c));
  }

  // Una fila por estudiante. Sin dato → celda sin valor (vacía).
  informe.filas.forEach((f, i) => {
    const r = PRIMERA_FILA_DATOS + i;
    const item = ws.getCell(r, 1);
    if (f.item !== null) item.value = f.item;
    item.alignment = { horizontal: "center" };
    ws.getCell(r, 2).value = f.nombre;
    informe.asignaturas.forEach((a, j) => {
      const cell = ws.getCell(r, 3 + j);
      const p = f.puntajes[a.subjectId];
      if (p) cell.value = p.puntaje;
      cell.numFmt = "0.0";
      cell.alignment = { horizontal: "center" };
    });
    for (let c = 1; c <= ultimaCol; c++) ws.getCell(r, c).border = borde;
  });
}

function hojaEstudiante(
  wb: ExcelJS.Workbook,
  informe: InformeGrupo,
  fila: FilaInformeGrupo,
  nombreHoja: string,
): void {
  const FILA_TITULO = 1;
  const FILA_PRUEBA = 3;
  const FILA_ESTUDIANTE = 4;
  const FILA_ENCABEZADO = 5;
  const PRIMERA_FILA_DATOS = 6;

  const ws = wb.addWorksheet(nombreHoja, {
    views: [{ state: "frozen", ySplit: FILA_ENCABEZADO }],
  });
  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 44;
  ws.getColumn(3).width = 14;

  ws.mergeCells(FILA_TITULO, 1, FILA_TITULO, 3);
  const titulo = ws.getCell(FILA_TITULO, 1);
  titulo.value = "INFORME POR ESTUDIANTE";
  titulo.font = { bold: true, size: 14 };
  titulo.alignment = { horizontal: "center" };

  ws.mergeCells(FILA_PRUEBA, 1, FILA_PRUEBA, 2);
  ws.getCell(FILA_PRUEBA, 1).value = `Prueba: ${informe.prueba.name}`;
  const grupo = ws.getCell(FILA_PRUEBA, 3);
  grupo.value = `GRUPO ${informe.grupo.name}`;
  grupo.alignment = { horizontal: "right" };

  ws.mergeCells(FILA_ESTUDIANTE, 1, FILA_ESTUDIANTE, 2);
  ws.getCell(FILA_ESTUDIANTE, 1).value = `Estudiante: ${fila.nombre}`;
  const numero = ws.getCell(FILA_ESTUDIANTE, 3);
  numero.value = fila.item !== null ? `No. ${fila.item}` : "";
  numero.alignment = { horizontal: "right" };

  ws.getCell(FILA_ENCABEZADO, 1).value = "ITEM";
  ws.getCell(FILA_ENCABEZADO, 2).value = "ASIGNATURA";
  ws.getCell(FILA_ENCABEZADO, 3).value = "RESULTADO";
  for (let c = 1; c <= 3; c++) estiloEncabezado(ws.getCell(FILA_ENCABEZADO, c));

  // Una fila por asignatura, en el orden de las columnas del grupo.
  informe.asignaturas.forEach((a, i) => {
    const r = PRIMERA_FILA_DATOS + i;
    const item = ws.getCell(r, 1);
    item.value = i + 1;
    item.alignment = { horizontal: "center" };
    ws.getCell(r, 2).value = a.nombre;
    const resultado = ws.getCell(r, 3);
    const p = fila.puntajes[a.subjectId];
    if (p) resultado.value = p.puntaje;
    resultado.numFmt = "0.0";
    resultado.alignment = { horizontal: "center" };
    for (let c = 1; c <= 3; c++) ws.getCell(r, c).border = borde;
  });
}

/** Excel limita los nombres de hoja a 31 caracteres y prohíbe `[]:*?/\`;
 *  tampoco pueden empezar o terminar en apóstrofo ni repetirse (sin
 *  distinguir mayúsculas). Se arma "<No.> <nombre>" y se desambigua con un
 *  sufijo si dos quedan iguales al recortar. */
export function nombresDeHojaEstudiante(filas: readonly FilaInformeGrupo[]): string[] {
  const MAX = 31;
  const usados = new Set([HOJA_GRUPO.toLowerCase()]);
  return filas.map((f, i) => {
    const base =
      `${f.item ?? i + 1}. ${f.nombre}`
        .replace(/[[\]:*?/\\]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^'+|'+$/g, "")
        .slice(0, MAX)
        .trim() || `Estudiante ${i + 1}`;
    let nombre = base;
    for (let n = 2; usados.has(nombre.toLowerCase()); n++) {
      const sufijo = ` (${n})`;
      nombre = `${base.slice(0, MAX - sufijo.length).trim()}${sufijo}`;
    }
    usados.add(nombre.toLowerCase());
    return nombre;
  });
}

export async function informeGrupoToXlsx(informe: InformeGrupo): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  hojaGrupo(wb, informe);
  const nombres = nombresDeHojaEstudiante(informe.filas);
  informe.filas.forEach((f, i) => hojaEstudiante(wb, informe, f, nombres[i]!));

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
