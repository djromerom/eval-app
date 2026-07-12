import type { StudentImportRow } from "../domain/student";

/**
 * Parser CSV nativo (sin dependencias) para la importación masiva de estudiantes.
 * Soporta comillas dobles, saltos de línea CRLF/LF y delimitador `,` o `;`
 * (Excel en es-CO suele exportar con `;`). El delimitador se autodetecta por
 * la línea de encabezado.
 */
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
    .replace(/[̀-ͯ]/g, "") // diacríticos combinados
    .replace(/[\s._-]/g, "");
}

// Sinónimos aceptados por columna → clave canónica.
const HEADER_ALIASES: Record<string, keyof StudentImportRow> = {
  nombre: "name",
  nombres: "name",
  nombrecompleto: "name",
  tipodoc: "idType",
  tipodocumento: "idType",
  tipoid: "idType",
  numdoc: "idNumber",
  numerodoc: "idNumber",
  numerodocumento: "idNumber",
  documento: "idNumber",
  identificacion: "idNumber",
  codigo: "code",
  codigoestudiantil: "code",
  grupo: "groupName",
  grupos: "groupName",
  anioingreso: "enrollmentYear",
  anoingreso: "enrollmentYear",
  aniodeingreso: "enrollmentYear",
  aningreso: "enrollmentYear",
};

export interface ParsedCsv {
  rows: StudentImportRow[];
  /** Columnas canónicas ausentes en el encabezado. */
  missing: (keyof StudentImportRow)[];
}

const REQUIRED: (keyof StudentImportRow)[] = [
  "name",
  "idType",
  "idNumber",
  "code",
  "groupName",
  "enrollmentYear",
];

export function parseStudentsCsv(text: string): ParsedCsv {
  const lines = text
    .replace(/^﻿/, "") // BOM
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) return { rows: [], missing: REQUIRED };

  const delimiter = detectDelimiter(lines[0]!);
  const headers = splitLine(lines[0]!, delimiter).map((h) => HEADER_ALIASES[normalizeHeader(h)]);
  const missing = REQUIRED.filter((r) => !headers.includes(r));
  if (missing.length > 0) return { rows: [], missing };

  const rows: StudentImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]!, delimiter);
    const record: Record<string, string> = {};
    headers.forEach((key, idx) => {
      if (key) record[key] = cells[idx] ?? "";
    });
    rows.push({
      name: record.name ?? "",
      idType: record.idType ?? "",
      idNumber: record.idNumber ?? "",
      code: record.code ?? "",
      groupName: record.groupName ?? "",
      enrollmentYear: Number(record.enrollmentYear ?? ""),
    });
  }
  return { rows, missing: [] };
}
