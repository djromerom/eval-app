/**
 * Formatter XLSX del listado de formulaciones. **Función pura** (no toca
 * I/O, no toca Next, no toca BD) → testeable sin setup.
 *
 * Por qué SheetJS (`xlsx` 0.18.5, ya en el repo como dep transitiva):
 * - Listados típicos ≤ 300 filas → sync va sobrado (no necesitamos
 *   `exceljs` streaming).
 * - Licencia: 0.18.x sigue Apache-2.0 (sin restricción comercial).
 *
 * Decisión de columnas: 11 separadas (no la unión "X / Y" de la UI). En
 * Excel cada columna es filtrable/ordenable individualmente — partir
 * `itemsTotal` / `itemsExpected` / `itemsBadge` lo hace más útil.
 *
 * Decisión de fechas: ISO 8601 (`updatedAt.toISOString()`). Excel lo
 * reconoce como fecha ordenable; el locale es-CO lo parsea a `dd/mm/aaaa`
 * con el formato regional del usuario.
 *
 * Decisión de `assignedTeachers[]`: serializado como string plano con
 * ", " (no array nativo en xlsx). Conserva la semántica sin complicar
 * el formato; para un análisis más rico el lector reabre y splitea.
 */
import * as XLSX from "xlsx";

import type { FormulacionRow } from "../queries/formulaciones/formulacion-row";
import type { AsignacionPendiente } from "../queries/formulaciones/asignacion-pendiente";

const HEADERS = [
  "Asignatura",
  "Grado",
  "Año Académico",
  "Prueba",
  "Tipo de Cuadernillo",
  "Estado",
  "Items Total",
  "Items Esperado",
  "Items Estado",
  "Docentes Asignados",
  "Docente Formulador",
  "Última Actualización",
] as const;

const STATUS_LABEL: Record<FormulacionRow["itemsBadge"], string> = {
  ok: "Exacto",
  low: "Faltan",
  high: "Sobran",
  none: "Sin regla",
};

/** Estado de una asignación pendiente: la tupla existe en la prueba pero
 *  todavía no tiene formulación. */
const PENDIENTE_STATUS_LABEL = "Sin formular";

function rowToCells(r: FormulacionRow): (string | number)[] {
  return [
    r.subjectName,
    r.courseName,
    r.academicYearYear,
    r.periodName ?? "",
    r.bookletTypeName ?? "",
    r.status,
    r.itemsTotal,
    r.itemsExpected ?? "", // "" en lugar de null → SheetJS genera celda vacía legible por sheet_to_json.
    STATUS_LABEL[r.itemsBadge],
    r.assignedTeachers.join(", "),
    r.authorName,
    r.updatedAt.toISOString(),
  ];
}

/** Fila de una asignación pendiente: el estado es "Sin formular" (todavía
 *  no hay formulación detrás) y las celdas de la formulación que no existen
 *  todavía van vacías; los ítems son 0 sobre los exigidos. */
function pendienteToCells(p: AsignacionPendiente): (string | number)[] {
  return [
    p.subjectName,
    p.courseName,
    p.academicYearYear,
    p.periodName,
    p.bookletTypeName ?? "",
    PENDIENTE_STATUS_LABEL,
    0,
    p.itemsExpected ?? "",
    p.itemsExpected == null ? STATUS_LABEL.none : STATUS_LABEL.low,
    p.assignedTeachers.join(", "),
    "",
    "",
  ];
}

/**
 * Serializa las filas a un `Buffer` XLSX listo para devolver como
 * `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
 *
 * `pendientes` son las asignaciones de la prueba que aún no tienen
 * formulación: se exports al final, con el estado "Sin formular", las celdas
 * que no aplican vacías (Docente Formulador, Última Actualización) y `0` ítems
 * sobre los exigidos por la regla.
 */
export function formulacionRowsToWorksheet(
  rows: FormulacionRow[],
  pendientes: AsignacionPendiente[] = [],
): Buffer {
  const aoa: (string | number)[][] = [HEADERS as unknown as (string | number)[]];
  for (const r of rows) aoa.push(rowToCells(r));
  for (const p of pendientes) aoa.push(pendienteToCells(p));

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Formulaciones");

  // type 'buffer' devuelve Node Buffer directamente (evita pasar por base64).
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  return buf as Buffer;
}
