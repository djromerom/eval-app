import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import { findConsulta } from "@/modules/consultas/domain/consultas-registry";
import {
  makeListFormulaciones,
  makeListCalificaciones,
} from "@/modules/consultas/infrastructure/container";
import { FormulacionesTable } from "./_components/formulaciones-table";
import { CalificacionesTable } from "./_components/calificaciones-table";

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
  // El ECU_LIDER entra al modulo, pero solo a las consultas que lo declaran en
  // `roles`. El 404 de abajo evita que adivinando la URL llegue a una que no
  // le corresponde; el `requireRole` del use case es la barrera real.
  const actor = await requireAuthenticatedUser("SUPER_ADMIN", "ECU_MASTER", "ECU_LIDER");

  const { id } = await params;
  const consulta = findConsulta(id);
  if (!consulta) notFound();
  if (!consulta.roles.some((r) => actor.roles.includes(r))) notFound();

  if (id === "calificaciones") {
    const res = await makeListCalificaciones().execute({ actor });
    const rows = res.ok ? res.value : [];
    return (
      <CalificacionesTable rows={rows} title={consulta.title} description={consulta.description} />
    );
  }

  if (id !== "formulaciones") {
    notFound();
  }

  const res = await makeListFormulaciones().execute({ actor });
  const rows = res.ok ? res.value : [];

  return (
    <FormulacionesTable rows={rows} title={consulta.title} description={consulta.description} />
  );
}
