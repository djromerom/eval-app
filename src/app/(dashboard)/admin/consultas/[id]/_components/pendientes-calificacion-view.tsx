"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import type { PendientesInforme } from "@/modules/consultas/domain/queries/pendientes-calificacion/pendiente";
import {
  etiquetaEstadoHoja,
  etiquetaMotivo,
} from "@/modules/consultas/domain/queries/pendientes-calificacion/pendiente";
import type { OpcionesPruebaGrupo } from "@/modules/consultas/domain/shared/opciones-prueba-grupo";

const select =
  "border-input bg-background focus-visible:border-primary focus-visible:ring-primary/20 rounded-md border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-hidden";

function buildQuery(periodId: string | null, groupId: string | null): string {
  const params = new URLSearchParams();
  if (periodId) params.set("prueba", periodId);
  if (groupId) params.set("grupo", groupId);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Pendientes de calificación. Los filtros (Prueba → Grupo) navegan con la
 * URL: el informe se arma en el servidor para esa selección. Los grupos se
 * acotan al año académico de la prueba elegida.
 */
export function PendientesCalificacionView({
  title,
  description,
  opciones,
  seleccion,
  informe,
  error,
}: {
  title: string;
  description: string;
  opciones: OpcionesPruebaGrupo;
  seleccion: { periodId: string | null; groupId: string | null };
  informe: PendientesInforme | null;
  error: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  // Selección local: refleja el cambio en el acto mientras el servidor arma el
  // informe (router.push corre en una transición y las props llegan después).
  // Se resincroniza cuando llegan las props de la navegación.
  const [sel, setSel] = useState(seleccion);
  useEffect(() => setSel(seleccion), [seleccion.periodId, seleccion.groupId]); // eslint-disable-line react-hooks/exhaustive-deps

  const prueba = opciones.pruebas.find((p) => p.id === sel.periodId) ?? null;
  const grupos = prueba
    ? opciones.grupos.filter((g) => g.academicYearId === prueba.academicYearId)
    : [];

  const navegar = (periodId: string | null, groupId: string | null) => {
    setSel({ periodId, groupId });
    startTransition(() => router.push(`${pathname}${buildQuery(periodId, groupId)}`));
  };

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          informe ? (
            <a
              href={`${pathname}/export.xlsx${buildQuery(informe.prueba.id, informe.grupo.id)}`}
              download
              className="border-input bg-background hover:bg-accent hover:text-accent-foreground inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 2v8m0 0 3-3m-3 3-3-3M3 13h10"
                />
              </svg>
              Descargar XLSX
            </a>
          ) : null
        }
      />

      <div className="space-y-4">
        <div className="bg-card flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Prueba</span>
            <select
              className={select}
              value={prueba?.id ?? ""}
              disabled={isPending}
              onChange={(e) => {
                const periodId = e.target.value || null;
                const nueva = opciones.pruebas.find((p) => p.id === periodId);
                // Un grupo de otro año académico deja de tener sentido.
                const sigueValiendo =
                  sel.groupId &&
                  nueva &&
                  opciones.grupos.some(
                    (g) => g.id === sel.groupId && g.academicYearId === nueva.academicYearId,
                  );
                navegar(periodId, sigueValiendo ? sel.groupId : null);
              }}
            >
              {/* Sin pruebas, o con una ?prueba= que no existe: opción vacía
                  para que elegir cualquier prueba dispare el cambio. */}
              {!prueba ? <option value="">—</option> : null}
              {opciones.pruebas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.year} · {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Grupo</span>
            <select
              className={select}
              value={sel.groupId ?? ""}
              disabled={isPending || !prueba}
              onChange={(e) => navegar(prueba?.id ?? null, e.target.value || null)}
            >
              <option value="">Selecciona un grupo</option>
              {grupos.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.courseName} · {g.name}
                </option>
              ))}
            </select>
          </label>
          {isPending ? (
            <span className="text-muted-foreground text-xs" role="status">
              Cargando…
            </span>
          ) : null}
        </div>

        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}

        {!informe ? (
          error ? null : (
            <p className="bg-card text-muted-foreground rounded-xl border p-6 text-sm">
              Selecciona una prueba y un grupo.
            </p>
          )
        ) : (
          <PendientesTabla informe={informe} />
        )}
      </div>
    </>
  );
}

function PendientesTabla({ informe }: { informe: PendientesInforme }) {
  const { resumen } = informe;

  return (
    <div className="space-y-2">
      <p className="text-sm">
        <span className="font-medium">Prueba:</span> {informe.prueba.name} ·{" "}
        <span className="font-medium">Grupo</span> {informe.grupo.name}
      </p>

      {resumen.total === 0 ? (
        <p className="bg-card text-muted-foreground rounded-xl border p-6 text-sm">
          Todo el grupo está al día en esta prueba: no hay hojas sin entregar, sin calificar ni sin
          marcar.
        </p>
      ) : (
        <>
          <p className="text-muted-foreground text-xs">
            {resumen.total} pendiente{resumen.total === 1 ? "" : "s"}: {resumen.sinHoja} sin hoja ·{" "}
            {resumen.sinCalificar} sin calificar · {resumen.sinMarcar} sin marcar
          </p>
          <div className="bg-card max-h-[70vh] overflow-auto rounded-xl border">
            <table className="w-full border-collapse text-sm">
              <thead className="text-xs font-medium tracking-wide uppercase">
                <tr>
                  <th className="bg-muted text-muted-foreground sticky top-0 left-0 z-30 w-14 border-r border-b px-3 py-2 text-center">
                    Item
                  </th>
                  <th className="bg-muted text-muted-foreground sticky top-0 left-14 z-30 min-w-[220px] border-r border-b px-3 py-2 text-left">
                    Estudiante
                  </th>
                  <th className="bg-muted text-muted-foreground sticky top-0 z-20 min-w-[160px] border-r border-b px-3 py-2 text-left">
                    Cuadernillo
                  </th>
                  <th className="bg-muted text-muted-foreground sticky top-0 z-20 border-b px-3 py-2 text-left">
                    Motivo
                  </th>
                  <th className="bg-muted text-muted-foreground sticky top-0 z-20 border-b px-3 py-2 text-center">
                    Respuestas
                  </th>
                  <th className="bg-muted text-muted-foreground sticky top-0 z-20 border-b px-3 py-2 text-center">
                    Puntaje
                  </th>
                </tr>
              </thead>
              <tbody>
                {informe.filas.map((f) => (
                  <tr
                    key={`${f.studentId}|${f.cuadernilloId}`}
                    className="hover:bg-muted/20 border-t"
                  >
                    <td className="bg-card sticky left-0 z-10 w-14 border-r px-3 py-1.5 text-center tabular-nums">
                      {f.item ?? ""}
                    </td>
                    <td className="bg-card sticky left-14 z-10 min-w-[220px] border-r px-3 py-1.5">
                      <span className="block">{f.studentName}</span>
                      <span className="text-muted-foreground block text-xs">{f.studentCode}</span>
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="block">{f.cuadernilloName}</span>
                      {f.asignaturas ? (
                        <span className="text-muted-foreground block text-xs">{f.asignaturas}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="block">{etiquetaMotivo(f.motivo)}</span>
                      {f.estadoHoja ? (
                        <span className="text-muted-foreground block text-xs">
                          {etiquetaEstadoHoja(f.estadoHoja)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5 text-center tabular-nums">
                      {f.marcadas === null ? "—" : `${f.marcadas}/${f.totalRespuestas ?? 0}`}
                    </td>
                    <td className="px-3 py-1.5 text-center tabular-nums">
                      {f.puntaje === null ? "—" : f.puntaje.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
