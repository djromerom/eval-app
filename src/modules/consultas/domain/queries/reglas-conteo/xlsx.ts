/**
 * Formatter XLSX de la consulta "Regla de conteo".
 * **Función pura** (no toca I/O, ni Next, ni BD) → testeable sin setup.
 *
 * Usa SheetJS (`xlsx`, ya en el repo) igual que el resto de consultas.
 */
import * as XLSX from "xlsx";

import type { ReglaConteoRow } from "./regla-conteo-row";

const HEADERS = [
  "Prueba",
  "Año",
  "Grado",
  "Asignatura",
  "Tipo de cuadernillo",
  "Conteo de ítems",
  "Formuladas",
] as const;

function rowToCells(r: ReglaConteoRow): (string | number)[] {
  return [
    r.periodName,
    r.academicYearYear,
    r.courseName,
    r.subjectName,
    r.bookletTypeName,
    r.exactQuestions,
    r.itemsFormulados,
  ];
}

/** Serializa las filas a un `Buffer` XLSX listo para devolver como
 *  `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`. */
export function reglaConteoRowsToWorksheet(rows: ReglaConteoRow[]): Buffer {
  const aoa: (string | number)[][] = [HEADERS as unknown as (string | number)[]];
  for (const r of rows) aoa.push(rowToCells(r));

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Regla de conteo");

  // type 'buffer' devuelve Node Buffer directamente (evita pasar por base64).
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  return buf as Buffer;
}
