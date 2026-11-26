/**
 * Formatter XLSX de la consulta "Pendientes de calificación".
 * **Función pura** (no toca I/O, ni Next, ni BD) → testeable sin setup.
 *
 * Usa SheetJS (`xlsx`, ya en el repo) igual que el resto de consultas.
 */
import * as XLSX from "xlsx";

import { etiquetaEstadoHoja, etiquetaMotivo, type FilaPendiente } from "./pendiente";

const HEADERS = [
  "Item",
  "Estudiante",
  "Código",
  "Grado",
  "Grupo",
  "Cuadernillo",
  "Asignaturas",
  "Motivo",
  "Estado de la hoja",
  "Respuestas marcadas",
  "Respuestas totales",
  "Puntaje",
  "Escaneada",
] as const;

function rowToCells(r: FilaPendiente): (string | number)[] {
  return [
    r.item ?? "",
    r.studentName,
    r.studentCode,
    r.courseName,
    r.groupName,
    r.cuadernilloName,
    r.asignaturas,
    etiquetaMotivo(r.motivo),
    etiquetaEstadoHoja(r.estadoHoja) ?? "",
    r.marcadas ?? "",
    r.totalRespuestas ?? "",
    r.puntaje ?? "",
    r.escaneadaAt ? r.escaneadaAt.toISOString() : "",
  ];
}

/** Serializa las filas a un `Buffer` XLSX listo para devolver como
 *  `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`. */
export function pendientesRowsToWorksheet(rows: FilaPendiente[]): Buffer {
  const aoa: (string | number)[][] = [HEADERS as unknown as (string | number)[]];
  for (const r of rows) aoa.push(rowToCells(r));

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Pendientes");

  // type 'buffer' devuelve Node Buffer directamente (evita pasar por base64).
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  return buf as Buffer;
}
