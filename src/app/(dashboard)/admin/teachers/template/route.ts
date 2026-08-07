import { requireAuthenticatedUser } from "@/lib/session";

/**
 * GET /admin/teachers/template
 * Devuelve un CSV con los headers esperados y una fila de ejemplo, para que
 * el admin lo abra en Excel y arme su listado de docentes.
 */
export async function GET() {
  await requireAuthenticatedUser("ECU_MASTER");
  const csv =
    "nombre,correo,tipodoc,numdoc,telefono\r\n" +
    "Juan Pérez,juan.perez@ejemplo.edu,CC,1234567890,3001234567\r\n";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="plantilla-docentes.csv"',
    },
  });
}
