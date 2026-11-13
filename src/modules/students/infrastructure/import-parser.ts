import { parseStudentsCsv, REQUIRED, type ParsedCsv } from "./csv";
import { parseStudentsXlsx } from "./xlsx";

/**
 * Punto de entrada único para parsear el archivo de importación masiva de
 * estudiantes. Detecta el formato por la extensión del filename y delega
 * en el parser específico. Mirror de
 * `src/modules/teachers/infrastructure/import-parser.ts:parseTeacherImport`.
 *
 * Formatos soportados:
 * - `.xlsx` / `.xls` → `parseStudentsXlsx` (SheetJS)
 * - `.csv` / `.txt`  → `parseStudentsCsv` (parser nativo)
 *
 * Si la extensión no es reconocida devuelve un error fatal con `missing`
 * poblado para que el caller (server action / use case) pueda mapearlo a
 * un mensaje claro al docente.
 */
export function parseStudentsImport(buffer: Buffer, filename: string): ParsedCsv {
  if (/\.xlsx?$/i.test(filename)) {
    return parseStudentsXlsx(buffer);
  }
  if (/\.csv$/i.test(filename) || /\.txt$/i.test(filename)) {
    return parseStudentsCsv(buffer.toString("utf8"));
  }
  return {
    rows: [],
    missing: REQUIRED,
    present: [],
    error: `Formato no soportado: "${filename}". Usa .xlsx o .csv.`,
  };
}
