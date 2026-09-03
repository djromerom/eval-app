import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import { findConsulta } from "@/modules/consultas/domain/consultas-registry";
import { makeListFormulaciones } from "@/modules/consultas/infrastructure/container";
import { FormulacionesTable } from "./_components/formulaciones-table";

export const metadata: Metadata = { title: "Consulta" };

/**
 * Render server-side de UNA consulta. Hoy solo se implementa `formulaciones`;
 *  futuras consultas llegan por el registry y se ramifican aquí con un switch
 *  (`switch (id) { case "formulaciones": ... }`).
 *
 *  El PageHeader vive DENTRO de `FormulacionesTable` (componente cliente)
 *  porque el botón "Descargar XLSX" en su slot `actions` necesita acceso al
 *  mismo `useState` de filtros. Pasar `title`+`description` desde el server
 *  al cliente es seguro (strings).
 */
export default async function ConsultaDetallePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuthenticatedUser("SUPER_ADMIN", "ECU_MASTER");

  const { id } = await params;
  const consulta = findConsulta(id);
  if (!consulta) notFound();

  if (id !== "formulaciones") {
    notFound();
  }

  const actor = await requireAuthenticatedUser("SUPER_ADMIN", "ECU_MASTER");
  const res = await makeListFormulaciones().execute({ actor });
  const rows = res.ok ? res.value : [];

  return (
    <FormulacionesTable rows={rows} title={consulta.title} description={consulta.description} />
  );
}
