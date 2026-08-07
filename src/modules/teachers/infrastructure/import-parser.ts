import * as XLSX from "xlsx";
import type { TeacherImportRow } from "../application/teachers";

/**
 * Parser de archivos de importación masiva de docentes (XLSX y CSV).
 * Sin dependencias externas más allá de `xlsx` (SheetJS) para el path XLSX; el
 * CSV usa un parser nativo (hand-rolled) copiado del de estudiantes para
 * soportar Excel-en-es-CO (delimitador `;`, CRLF, BOM, comillas dobles).
 *
 * Devuelve `TeacherImportRow[]` en formato crudo (sin trim ni lower ni
 * upper-case) — la normalización vive en `ImportTeachers.execute()`.
 */

export interface ParsedImport {
  rows: TeacherImportRow[];
  /** Claves canónicas ausentes en el encabezado. */
  missing: (keyof TeacherImportRow)[];
  /** Mensaje de error fatal (archivo ilegible, etc.). */
  error?: string;
}

const REQUIRED: (keyof TeacherImportRow)[] = ["name", "email", "idType", "idNumber"];

// Sinónimos aceptados por columna → clave canónica. Las claves se normalizan
// a minúsculas + sin tildes + sin separadores (ver normalizeHeader), así que
// variantes como "e-mail", "e_mail" o "e mail" colapsan a "email".
const HEADER_ALIASES: Record<string, keyof TeacherImportRow> = {
  nombre: "name",
  nombres: "name",
  nombrecompleto: "name",
  name: "name",

  correo: "email",
  email: "email",
  correoelectronico: "email",

  tipodoc: "idType",
  tipodocumento: "idType",
  tipoid: "idType",
  idtype: "idType",

  numdoc: "idNumber",
  numerodoc: "idNumber",
  numerodocumento: "idNumber",
  idnumber: "idNumber",
  documento: "idNumber",
  identificacion: "idNumber",

  telefono: "phone",
  celular: "phone",
  phone: "phone",
  tel: "phone",
};

/** Punto de entrada: detecta el formato por la extensión del archivo. */
export function parseTeacherImport(buffer: Buffer, filename: string): ParsedImport {
  if (/\.xlsx?$/i.test(filename)) {
    return parseXlsx(buffer);
  }
  if (/\.csv$/i.test(filename) || /\.(txt)$/i.test(filename)) {
    return parseCsv(buffer.toString("utf8"));
  }
  return {
    rows: [],
    missing: REQUIRED,
    error: `Formato no soportado: "${filename}". Usa .xlsx o .csv.`,
  };
}

function parseXlsx(buffer: Buffer): ParsedImport {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer" });
  } catch (e) {
    return { rows: [], missing: REQUIRED, error: `Archivo XLSX inválido: ${(e as Error).message}` };
  }
  const firstName = wb.SheetNames[0];
  if (!firstName) return { rows: [], missing: REQUIRED, error: "El archivo no contiene hojas." };
  const sheet = wb.Sheets[firstName];
  if (!sheet) return { rows: [], missing: REQUIRED, error: "El archivo no contiene hojas." };
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });
  return aoaToRows(aoa);
}

// ============= CSV nativo (copiado del parser de estudiantes) =============

function detectDelimiter(headerLine: string): "," | ";" {
  return headerLine.split(";").length > headerLine.split(",").length ? ";" : ",";
}

function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

/** Normaliza un encabezado: minúsculas, sin tildes, sin separadores. */
function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s._-]/g, "");
}

function parseCsv(text: string): ParsedImport {
  const lines = text
    .replace(/^﻿/, "") // BOM
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return { rows: [], missing: REQUIRED, error: "El archivo está vacío." };
  }
  const delimiter = detectDelimiter(lines[0]!);
  const headers = splitLine(lines[0]!, delimiter).map((h) => HEADER_ALIASES[normalizeHeader(h)]);
  const missing = REQUIRED.filter((r) => !headers.includes(r));
  if (missing.length > 0) return { rows: [], missing };

  const rows: TeacherImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]!, delimiter);
    const record: Record<string, string> = {};
    headers.forEach((key, idx) => {
      if (key) record[key] = cells[idx] ?? "";
    });
    rows.push({
      name: record.name ?? "",
      email: record.email ?? "",
      idType: record.idType ?? "",
      idNumber: record.idNumber ?? "",
      phone: record.phone || undefined,
    });
  }
  return { rows, missing: [] };
}

function aoaToRows(aoa: unknown[][]): ParsedImport {
  if (aoa.length === 0) {
    return { rows: [], missing: REQUIRED, error: "El archivo está vacío." };
  }
  const headerRow = aoa[0] as unknown[];
  const headers = headerRow.map((h) => HEADER_ALIASES[normalizeHeader(String(h ?? ""))]);
  const missing = REQUIRED.filter((r) => !headers.includes(r));
  if (missing.length > 0) return { rows: [], missing };

  const rows: TeacherImportRow[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const cells = (aoa[i] as unknown[]) ?? [];
    // descartar filas completamente vacías (todas las celdas en blanco)
    if (cells.every((c) => !c || !String(c).trim())) continue;
    const record: Record<string, string> = {};
    headers.forEach((key, idx) => {
      if (key) record[key] = String(cells[idx] ?? "");
    });
    rows.push({
      name: record.name ?? "",
      email: record.email ?? "",
      idType: record.idType ?? "",
      idNumber: record.idNumber ?? "",
      phone: record.phone || undefined,
    });
  }
  if (rows.length === 0) {
    return { rows: [], missing: [], error: "El archivo no contiene filas de datos." };
  }
  return { rows, missing: [] };
}
