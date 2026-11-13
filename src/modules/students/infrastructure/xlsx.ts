import * as XLSX from "xlsx";

import type { StudentImportRow } from "../domain/student";
import {
  canonicalHeaders,
  missingRequired,
  presentKeys,
  rowToStudentRow,
  type ParsedCsv,
} from "./csv";

/**
 * Parser XLSX institucional para estudiantes. Acepta la planilla que el
 * docente sube desde su colegio con columnas como `GRADO_COD`, `GRUPO`,
 * `DOC`, `TIPODOC`, `APELLIDO1`, `APELLIDO2`, `NOMBRE1`, `NOMBRE2`,
 * `CODIGO`, `ANIO_INGRESO`, `TIPO DE CUADERNILLO`.
 *
 * Reutiliza el mismo HEADER_ALIASES + REQUIRED + recordToStudentRow que
 * el parser CSV para que ambas rutas compartan:
 * - Resolución de sinónimos de header (tildes, mayúsculas, separadores).
 * - Backward-compat con columna legacy `nombre`.
 * - Normalización de TIPODOC (`RC:REGISTRO CIVIL...` → `R.C.`).
 */
export function parseStudentsXlsx(buffer: Buffer): ParsedCsv {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch (err) {
    return {
      rows: [],
      missing: [],
      present: [],
      error: `Archivo XLSX ilegible: ${(err as Error).message}`,
    };
  }

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return { rows: [], missing: [], present: [], error: "El archivo XLSX no tiene hojas" };
  }
  const sheet = workbook.Sheets[firstSheetName]!;

  // `header: 1` → array de arrays (fila 0 = headers).
  // `defval: ""` → celdas vacías llegan como "", no undefined.
  // `blankrows: false` → descarta filas totalmente vacías (un trailing
  // newline de Excel no debería contar como un estudiante).
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });
  if (aoa.length === 0) {
    return { rows: [], missing: [], present: [], error: "El archivo XLSX está vacío" };
  }

  const rawHeaders = (aoa[0] ?? []).map((c) => String(c ?? ""));
  const headers = canonicalHeaders(rawHeaders);
  const missing = missingRequired(headers);
  const present = presentKeys(headers);

  // Igual que el parser CSV: las filas se parsean aunque falten columnas
  // (las valida el use case fila a fila). El caller bloquea solo si faltan
  // las columnas imprescindibles.
  const rows: StudentImportRow[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const cells = (aoa[i] ?? []).map((c) => String(c ?? ""));
    rows.push(rowToStudentRow(headers, cells));
  }
  return { rows, missing, present };
}
