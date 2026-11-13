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

/** Normaliza un encabezado: minúsculas, sin tildes, sin separadores.
 *  Re-exportado para que el parser XLSX comparta la misma normalización. */
export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // diacríticos combinados
    .replace(/[\s._-]/g, "");
}

// Sinónimos aceptados por columna → clave canónica (o `__legacyName` para el
// campo legacy `nombre` que se parte por whitespace en el row builder).
// Re-exportado para que el parser XLSX comparta el mismo diccionario.
export type CanonicalKey = keyof StudentImportRow | "__legacyName";
export const HEADER_ALIASES: Record<string, CanonicalKey> = {
  // Apellidos y nombres partidos (preferidos a partir de sep 2026)
  apellido1: "lastName1",
  primerapellido: "lastName1",
  apellido2: "lastName2",
  segundoapellido: "lastName2",
  // Typo de la planilla institucional ("SEGUBD APELLIDO" por "SEGUNDO
  // APELLIDO"): se acepta para no obligar al docente a renombrar.
  segubdapellido: "lastName2",
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
  doc: "idNumber",
  codigo: "code",
  codigoestudiantil: "code",
  // La planilla institucional rotula el código como "ID" (y el tipo de
  // cuadernillo con su nombre informal). Aceptamos ambos sin que el
  // docente tenga que renombrar columnas.
  id: "code",
  grupo: "groupName",
  grupos: "groupName",
  anioingreso: "enrollmentYear",
  anoingreso: "enrollmentYear",
  aniodeingreso: "enrollmentYear",
  aningreso: "enrollmentYear",
  // Nuevos (sep 2026): grado + tipo de cuadernillo desde XLSX institucional.
  grado: "grade",
  gradocod: "grade",
  tipodecuadernillo: "bookletTypeName",
  tipocuadernillo: "bookletTypeName",
  cuadernillo: "bookletTypeName",
  prueba: "periodName",
  periodo: "periodName",
  period: "periodName",
};

/** Columnas canónicas que el encabezado debe traer (o el legacy `nombre`
 *  que satisface lastName1 + firstName1). Re-exportado para tests. */
export const REQUIRED: (keyof StudentImportRow)[] = [
  "lastName1",
  "firstName1",
  "idType",
  "idNumber",
  "code",
  "groupName",
  "enrollmentYear",
];

/** Resultado uniforme de cualquier parser de importación (CSV o XLSX). */
export interface ParsedCsv {
  rows: StudentImportRow[];
  /** Columnas canónicas ausentes en el encabezado. */
  missing: (keyof StudentImportRow)[];
  /** Columnas canónicas PRESENTES en el encabezado. El import en modo
   *  "actualizar" usa esta lista para escribir SOLO lo que el archivo trae
   *  (si el archivo no trae `tipo_doc`, no se toca el tipo de documento que
   *  ya tiene el estudiante). */
  present: (keyof StudentImportRow)[];
  /** Mensaje de error fatal (archivo ilegible, etc.). */
  error?: string;
}

/** Devuelve la i-ésima palabra (0-based) del nombre legacy, o "" si no existe. */
function splitLegacy(name: string, index: number): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return parts[index] ?? "";
}

/** Si TIPODOC viene como "RC:REGISTRO CIVIL DE NACIMIENTO", extrae "RC" antes
 *  del `:`. Si no hay `:`, devuelve el valor tal cual. Luego pasa por trim
 *  — la validación contra `ID_TYPES` ocurre en el use case. */
function extractIdType(raw: string): string {
  const trimmed = raw.trim();
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx > 0) return trimmed.slice(0, colonIdx).trim();
  return trimmed;
}

/** Construye un `StudentImportRow` desde el mapa `record` con headers
 *  canónicos. Usado por CSV y XLSX. Centraliza la lógica legacy-name split
 *  y la normalización de TIPODOC para que ambos formatos la compartan. */
export function recordToStudentRow(record: Record<string, string>): StudentImportRow {
  // Backward-compat: si vino columna legacy `nombre` y no llegaron las 4
  // separadas, parte por whitespace para no bloquear archivos viejos del
  // docente (apellido1 apellido2 nombre1 nombre2).
  const legacyName = (record.__legacyName ?? "").trim();
  const lastName1 = (record.lastName1 ?? "").trim() || splitLegacy(legacyName, 0);
  const lastName2 = (record.lastName2 ?? "").trim() || splitLegacy(legacyName, 1);
  const firstName1 = (record.firstName1 ?? "").trim() || splitLegacy(legacyName, 2);
  const firstName2 = (record.firstName2 ?? "").trim() || splitLegacy(legacyName, 3);
  return {
    lastName1,
    lastName2,
    firstName1,
    firstName2,
    idType: extractIdType(record.idType ?? ""),
    idNumber: record.idNumber ?? "",
    code: record.code ?? "",
    groupName: record.groupName ?? "",
    enrollmentYear: Number(record.enrollmentYear ?? ""),
    grade: record.grade ?? "",
    bookletTypeName: record.bookletTypeName ?? "",
    periodName: record.periodName ?? "",
  };
}

/** Convierte un array de headers en bruto al array de claves canónicas
 *  usando HEADER_ALIASES + normalizeHeader. Los headers no reconocidos
 *  quedan `undefined` en su posición — el row builder los ignora. */
export function canonicalHeaders(rawHeaders: string[]): (CanonicalKey | undefined)[] {
  return rawHeaders.map((h) => HEADER_ALIASES[normalizeHeader(h)]);
}

/** Claves canónicas que el encabezado trae. El legacy `nombre` cuenta como
 *  las 4 partes del nombre (el row builder lo parte por whitespace), así
 *  que un archivo con esa columna puede actualizar apellidos y nombres. */
export function presentKeys(headers: (CanonicalKey | undefined)[]): (keyof StudentImportRow)[] {
  const keys = new Set<keyof StudentImportRow>();
  for (const header of headers) {
    if (!header) continue;
    if (header === "__legacyName") {
      keys.add("lastName1");
      keys.add("lastName2");
      keys.add("firstName1");
      keys.add("firstName2");
      continue;
    }
    keys.add(header);
  }
  return [...keys];
}

/** Aplica el filtro de REQUIRED a los headers canónicos. `__legacyName`
 *  satisface `lastName1` + `firstName1` (backward-compat con CSVs viejos). */
export function missingRequired(headers: (CanonicalKey | undefined)[]): (keyof StudentImportRow)[] {
  const hasLegacy = (headers as CanonicalKey[]).includes("__legacyName");
  return REQUIRED.filter(
    (r) =>
      !(headers as CanonicalKey[]).includes(r) &&
      !(hasLegacy && (r === "lastName1" || r === "firstName1")),
  );
}

/** Construye un `StudentImportRow` a partir de una fila cruda (array de
 *  celdas) y los headers canónicos correspondientes. Usado por CSV y XLSX. */
export function rowToStudentRow(
  headers: (CanonicalKey | undefined)[],
  cells: string[],
): StudentImportRow {
  const record: Record<string, string> = {};
  headers.forEach((key, idx) => {
    if (key) record[key] = cells[idx] ?? "";
  });
  return recordToStudentRow(record);
}

/** Parsea un CSV de estudiantes. Re-exportado desde el dispatcher principal
 *  para compat con tests viejos. */
export function parseStudentsCsv(text: string): ParsedCsv {
  const lines = text
    .replace(/^﻿/, "") // BOM
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) return { rows: [], missing: REQUIRED, present: [] };

  const delimiter = detectDelimiter(lines[0]!);
  const headers = splitLine(lines[0]!, delimiter).map((h) => HEADER_ALIASES[normalizeHeader(h)]);
  const missing = missingRequired(headers);
  const present = presentKeys(headers);

  // Las filas se parsean aunque falten columnas: el use case valida fila a
  // fila. Las columnas imprescindibles (código, nombres, grupo) las bloquea
  // el caller; las demás (tipo/número de documento, año de ingreso) solo
  // hacen falta para CREAR estudiantes nuevos — si el código ya existe, la
  // fila actualiza al estudiante con lo que el archivo sí trae.
  const rows: StudentImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]!, delimiter);
    rows.push(rowToStudentRow(headers, cells));
  }
  return { rows, missing, present };
}
