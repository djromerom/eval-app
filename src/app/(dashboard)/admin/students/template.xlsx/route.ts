import * as XLSX from "xlsx";

import { requireAuthenticatedUser } from "@/lib/session";

/**
 * GET /admin/students/template.xlsx
 * Devuelve un XLSX con los headers que espera el parser institucional y una
 * fila de ejemplo, para que el admin lo abra en Excel/Sheets y arme su
 * planilla. Headers en MAYÚSCULAS para coincidir con la planilla que el
 * docente trae del colegio (GRADO_COD, GRUPO, DOC, TIPODOC, etc.).
 */
export const dynamic = "force-dynamic"; // auth + headers siempre frescos

export async function GET(): Promise<Response> {
  await requireAuthenticatedUser("ECU_MASTER");

  const headers = [
    "GRADO_COD",
    "GRUPO",
    "DOC",
    "TIPODOC",
    "APELLIDO1",
    "APELLIDO2",
    "NOMBRE1",
    "NOMBRE2",
    "CODIGO",
    "ANIO_INGRESO",
    "PRUEBA",
    "TIPO DE CUADERNILLO",
  ];
  const example = [
    "2",
    "201",
    "1123417172",
    "R.C.",
    "BERMUDEZ",
    "ALMAZO",
    "DARIEL",
    "DAVID",
    "EST-001",
    "2026",
    "I Periodo",
    "ESTANDAR",
  ];

  const worksheet = XLSX.utils.aoa_to_sheet([headers, example]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Estudiantes");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plantilla-estudiantes.xlsx"',
      "Content-Length": String(buffer.length),
      "Cache-Control": "no-store",
    },
  });
}
