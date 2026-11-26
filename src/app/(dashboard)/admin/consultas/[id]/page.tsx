import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import { findConsulta } from "@/modules/consultas/domain/consultas-registry";
import { makeGetCurrentPeriod } from "@/modules/academic/infrastructure/container";
import {
  makeListFormulaciones,
  makeListAsignacionesPendientes,
  makeListPruebas,
  makeListFormuladores,
  makeListCalificaciones,
  makeListReglasConteo,
  makeGetInformeGrupo,
  makeListPendientesCalificacion,
} from "@/modules/consultas/infrastructure/container";
import { pruebaActual } from "@/modules/consultas/domain/shared/prueba-opcion";
import { FormulacionesTable } from "./_components/formulaciones-table";
import { FormuladoresTable } from "./_components/formuladores-table";
import { CalificacionesTable } from "./_components/calificaciones-table";
import { ReglasConteoTable } from "./_components/reglas-conteo-table";
import { InformeGrupoView } from "./_components/informe-grupo-view";
import { PendientesCalificacionView } from "./_components/pendientes-calificacion-view";

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
export default async function ConsultaDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ prueba?: string; grupo?: string }>;
}) {
  // El ECU_LIDER entra al modulo, pero solo a las consultas que lo declaran en
  // `roles`. El 404 de abajo evita que adivinando la URL llegue a una que no
  // le corresponde; el `requireRole` del use case es la barrera real.
  const actor = await requireAuthenticatedUser("SUPER_ADMIN", "ECU_MASTER", "ECU_LIDER");

  const { id } = await params;
  const consulta = findConsulta(id);
  if (!consulta) notFound();
  if (!consulta.roles.some((r) => actor.roles.includes(r))) notFound();

  // Informe por grupo: los filtros viajan en la URL (?prueba=&grupo=) porque
  // el informe se arma en el servidor y depende de ambos; no tiene sentido
  // traer todo y filtrar en el cliente como en las otras consultas.
  if (id === "informe-grupo") {
    const sp = (await searchParams) ?? {};
    const res = await makeGetInformeGrupo().execute({
      actor,
      periodId: sp.prueba || undefined,
      groupId: sp.grupo || undefined,
    });
    return (
      <InformeGrupoView
        title={consulta.title}
        description={consulta.description}
        opciones={res.ok ? res.value.opciones : { pruebas: [], grupos: [] }}
        seleccion={
          res.ok ? res.value.seleccion : { periodId: sp.prueba ?? null, groupId: sp.grupo ?? null }
        }
        informe={res.ok ? res.value.informe : null}
        error={res.ok ? (res.value.error?.message ?? null) : res.error.message}
      />
    );
  }

  // Pendientes de calificación: mismos filtros que el informe por grupo
  // (prueba + grupo), porque el reporte se arma en el servidor para esa
  // selección.
  if (id === "pendientes-calificacion") {
    const sp = (await searchParams) ?? {};
    const res = await makeListPendientesCalificacion().execute({
      actor,
      periodId: sp.prueba || undefined,
      groupId: sp.grupo || undefined,
    });
    return (
      <PendientesCalificacionView
        title={consulta.title}
        description={consulta.description}
        opciones={res.ok ? res.value.opciones : { pruebas: [], grupos: [] }}
        seleccion={
          res.ok ? res.value.seleccion : { periodId: sp.prueba ?? null, groupId: sp.grupo ?? null }
        }
        informe={res.ok ? res.value.informe : null}
        error={res.ok ? (res.value.error?.message ?? null) : res.error.message}
      />
    );
  }

  if (id === "formuladores") {
    const res = await makeListFormuladores().execute({ actor });
    const rows = res.ok ? res.value : [];
    return (
      <FormuladoresTable rows={rows} title={consulta.title} description={consulta.description} />
    );
  }

  if (id === "calificaciones") {
    const [res, pruebasRes, currentRes] = await Promise.all([
      makeListCalificaciones().execute({ actor }),
      // Opciones del filtro "Prueba": el catálogo de la institución, no las
      // filas (una prueba sin hojas debe aparecer igual). El ECU_LIDER no
      // puede listar pruebas: en ese caso el filtro se arma con las filas.
      makeListPruebas().execute({ actor }),
      makeGetCurrentPeriod().execute({ actor }),
    ]);
    const rows = res.ok ? res.value : [];
    const pruebas = pruebasRes.ok ? pruebasRes.value : [];
    const current = currentRes.ok ? currentRes.value : null;
    return (
      <CalificacionesTable
        rows={rows}
        title={consulta.title}
        description={consulta.description}
        pruebas={pruebas}
        defaultPeriodId={current?.id ?? null}
      />
    );
  }

  if (id === "reglas-conteo") {
    const [res, pruebasRes, currentRes] = await Promise.all([
      makeListReglasConteo().execute({ actor }),
      makeListPruebas().execute({ actor }),
      makeGetCurrentPeriod().execute({ actor }),
    ]);
    const rows = res.ok ? res.value : [];
    const pruebas = pruebasRes.ok ? pruebasRes.value : [];
    const current = currentRes.ok ? currentRes.value : null;
    return (
      <ReglasConteoTable
        rows={rows}
        title={consulta.title}
        description={consulta.description}
        pruebas={pruebas.map((p) => ({ id: p.id, name: p.name, year: p.year }))}
        defaultPeriodId={current?.id ?? null}
      />
    );
  }

  if (id !== "formulaciones") {
    notFound();
  }

  const [res, pruebasRes, pendientesRes] = await Promise.all([
    makeListFormulaciones().execute({ actor }),
    makeListPruebas().execute({ actor }),
    makeListAsignacionesPendientes().execute({ actor }),
  ]);
  const rows = res.ok ? res.value : [];
  const pruebas = pruebasRes.ok ? pruebasRes.value : [];
  // Asignaciones de las pruebas que aún no tienen formulación: el listado las
  // trae para que el admin vea qué falta, no solo lo que ya está escrito.
  const pendientes = pendientesRes.ok ? pendientesRes.value : [];

  // El filtro de prueba arranca en la que está en curso (la marcada como
  // actual en el año académico actual). Si ninguna está marcada, el filtro
  // queda en "todas las pruebas" — ver `pruebaActual`.
  const current = pruebaActual(pruebas);

  return (
    <FormulacionesTable
      rows={rows}
      pendientes={pendientes}
      title={consulta.title}
      description={consulta.description}
      pruebas={pruebas}
      defaultPeriodId={current?.id ?? null}
    />
  );
}
