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

// Sinónimos aceptados por columna → clave canónica (o `__legacyName` para el
// campo legacy `nombre` que se parte por whitespace en el row builder).
type CanonicalKey = keyof StudentImportRow | "__legacyName";
const HEADER_ALIASES: Record<string, CanonicalKey> = {
  // Apellidos y nombres partidos (preferidos a partir de sep 2026)
  apellido1: "lastName1",
  primerapellido: "lastName1",
  apellido2: "lastName2",
  segundoapellido: "lastName2",
  nombre1: "firstName1",
  primernombre: "firstName1",
  nombre2: "firstName2",
  segundonombre: "firstName2",
  // Legacy: nombre completo (se parte por whitespace en el row builder)
  nombre: "__legacyName",
  nombres: "__legacyName",
  nombrecompleto: "__legacyName",
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
  "lastName1",
  "firstName1",
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
  const headers = splitLine(lines[0]!, delimiter).map(
    (h) => HEADER_ALIASES[normalizeHeader(h)] as CanonicalKey | undefined,
  );
  // Backward-compat: la columna legacy `nombre` satisface los REQUIRED de
  // lastName1 + firstName1 (se parte por whitespace en el row builder). Así
  // los CSVs viejos del docente siguen funcionando sin pedirle migrar a las 4
  // columnas separadas.
  const hasLegacyName = headers.includes("__legacyName");
  const missing = REQUIRED.filter(
    (r) => !headers.includes(r) && !(hasLegacyName && (r === "lastName1" || r === "firstName1")),
  );
  if (missing.length > 0) return { rows: [], missing };

  const rows: StudentImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]!, delimiter);
    const record: Record<string, string> = {};
    headers.forEach((key, idx) => {
      if (key) record[key] = cells[idx] ?? "";
    });
    // Backward-compat: si vino columna legacy `nombre` y no llegaron las 4
    // separadas, parte por whitespace para no bloquear CSVs viejos del
    // docente (apellido1 apellido2 nombre1 nombre2).
    const legacyName = (record.__legacyName ?? "").trim();
    const lastName1 = (record.lastName1 ?? "").trim() || splitLegacy(legacyName, 0);
    const lastName2 = (record.lastName2 ?? "").trim() || splitLegacy(legacyName, 1);
    const firstName1 = (record.firstName1 ?? "").trim() || splitLegacy(legacyName, 2);
    const firstName2 = (record.firstName2 ?? "").trim() || splitLegacy(legacyName, 3);
    rows.push({
      lastName1,
      lastName2,
      firstName1,
      firstName2,
      idType: record.idType ?? "",
      idNumber: record.idNumber ?? "",
      code: record.code ?? "",
      groupName: record.groupName ?? "",
      enrollmentYear: Number(record.enrollmentYear ?? ""),
    });
  }
  return { rows, missing: [] };
}

/** Devuelve la i-ésima palabra (0-based) del nombre legacy, o "" si no existe. */
function splitLegacy(name: string, index: number): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return parts[index] ?? "";
}
