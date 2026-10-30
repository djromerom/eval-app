/**
 * Formatter XLSX de la consulta "Docentes formuladores por cuadernillo".
 * **Función pura** (no toca I/O, ni Next, ni BD) → testeable sin setup.
 *
 * Usa SheetJS (`xlsx`, ya en el repo) igual que el listado de formulaciones:
 * el dataset es de cientos de filas, no de millones, así que el modo sync
 * alcanza y sobra.
 *
 * Decisión de columnas: las 8 que pidió el docente (Cuadernillo, Grado,
 * Asignatura, Formulador, Tipo doc., ID, Email, Celular) van primero, en ese
 * orden, y al final se agregan las 3 que hacen falta para que la tabla sea
 * interpretable (Prueba, Formulación, Estado).
 *
 * Los datos de contacto que el docente no tiene cargados se exportan como
 * celda VACÍA (no "—") para que en Excel no se confundan con un valor real
 * y los filtros del archivo no los arrastren.
 */
import * as XLSX from "xlsx";

import { ESTADO_LABEL, pruebaLabel, type FormuladorRow } from "./formulador-row";

const HEADERS = [
  "Cuadernillo",
  "Grado",
  "Asignatura",
  "Formulador",
  "Tipo doc.",
  "ID",
  "Email",
  "Celular",
  "Prueba",
  "Formulación",
  "Estado",
] as const;

function rowToCells(r: FormuladorRow): (string | number)[] {
  return [
    r.cuadernillo,
    r.grado,
    r.asignatura,
    r.formulador,
    r.tipoDocumento ?? "",
    r.documento ?? "",
    r.email ?? "",
    r.celular ?? "",
    pruebaLabel(r),
    r.formulacion ?? "",
    ESTADO_LABEL[r.estado],
  ];
}

/** Serializa las filas a un `Buffer` XLSX listo para devolver como
 *  `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`. */
export function formuladorRowsToWorksheet(rows: FormuladorRow[]): Buffer {
  const aoa: (string | number)[][] = [HEADERS as unknown as (string | number)[]];
  for (const r of rows) aoa.push(rowToCells(r));

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Formuladores");

  // type 'buffer' devuelve Node Buffer directamente (evita pasar por base64).
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  return buf as Buffer;
}
