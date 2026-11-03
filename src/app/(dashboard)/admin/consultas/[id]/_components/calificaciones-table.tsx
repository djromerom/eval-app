"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { CalificacionRow } from "@/modules/consultas/domain/queries/calificaciones/calificacion-row";
import type { PruebaOpcion } from "@/modules/consultas/domain/shared/prueba-opcion";
import { PageHeader } from "@/components/page-header";
import { etiquetaEstado } from "@/modules/consultas/domain/queries/calificaciones/estado";
import { HistorialModal } from "./historial-modal";
import {
  CalificacionesFilterRow,
  EMPTY_CALIFICACIONES_FILTERS,
  type CalificacionesFilterState,
  type OpcionGrado,
  type OpcionGrupo,
  type OpcionSimple,
} from "./calificaciones-filter-row";

/** Listado de la consulta "Calificaciones": PageHeader + filtros + tabla.
 *
 *  Las opciones de grado y grupo se derivan de las propias filas, no de un
 *  fetch aparte. Eso hace que el desplegable muestre exactamente el alcance
 *  del actor: un líder ECU solo ve sus grados listados, sin que la UI tenga
 *  que conocer la regla de permisos.
 *
 *  Sin paginación, igual que la consulta de formulaciones. Si un lote real
 *  supera unas cientos de hojas conviene pasar a searchParams-driven. */
export function CalificacionesTable({
  rows,
  title,
  description,
  actions,
  pruebas,
  defaultPeriodId,
}: {
  rows: CalificacionRow[];
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  /** Pruebas de la institución: opciones del filtro "Prueba". Si viene
   *  vacío (el actor no puede listar pruebas), se derivan de las filas. */
  pruebas?: PruebaOpcion[];
  /** Prueba preseleccionada en el filtro (la que está en curso). `null` =
   *  el filtro queda en "todas las pruebas". */
  defaultPeriodId?: string | null;
}) {
  // El filtro de prueba arranca en la prueba en curso, igual que la consulta
  // "Listado de Formulaciones": el boletín se mira para la prueba que se
  // está aplicando, no para el histórico completo.
  const [filters, setFilters] = useState<CalificacionesFilterState>(() => ({
    ...EMPTY_CALIFICACIONES_FILTERS,
    periodId: defaultPeriodId ?? "",
  }));
  const [historial, setHistorial] = useState<CalificacionRow | null>(null);

  const { gradoOptions, grupoOptions, pruebaOptions, tipoOptions } = useMemo(() => {
    const grados = new Map<string, OpcionGrado>();
    const grupos = new Map<string, OpcionGrupo>();
    const pruebasDeFilas = new Map<string, OpcionSimple>();
    const tipos = new Map<string, OpcionSimple>();
    for (const r of rows) {
      grados.set(r.courseId, { id: r.courseId, name: r.courseName });
      grupos.set(r.groupId, { id: r.groupId, name: r.groupName, courseId: r.courseId });
      // Prueba y tipo son opcionales: solo se ofrecen si alguna fila los tiene.
      if (r.periodId && r.periodName) {
        pruebasDeFilas.set(r.periodId, { id: r.periodId, name: r.periodName });
      }
      if (r.bookletTypeId && r.bookletTypeName) {
        tipos.set(r.bookletTypeId, { id: r.bookletTypeId, name: r.bookletTypeName });
      }
    }
    // Las opciones de prueba salen del catálogo de pruebas de la institución
    // (no de las filas): una prueba sin hojas debe aparecer igual, o el
    // filtro arrancaría en una prueba que no está en la lista.
    const opcionesPrueba = new Map<string, OpcionSimple>(pruebasDeFilas);
    for (const p of pruebas ?? []) opcionesPrueba.set(p.id, { id: p.id, name: p.name });
    const porNombre = (a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name, "es", { numeric: true });
    return {
      gradoOptions: Array.from(grados.values()).sort(porNombre),
      grupoOptions: Array.from(grupos.values()).sort(porNombre),
      pruebaOptions: Array.from(opcionesPrueba.values()).sort(porNombre),
      tipoOptions: Array.from(tipos.values()).sort(porNombre),
    };
  }, [rows, pruebas]);

  const visible = useMemo(
    () =>
      rows.filter((r) => {
        if (filters.courseId && r.courseId !== filters.courseId) return false;
        if (filters.groupId && r.groupId !== filters.groupId) return false;
        if (filters.periodId && r.periodId !== filters.periodId) return false;
        if (filters.bookletTypeId && r.bookletTypeId !== filters.bookletTypeId) return false;
        if (filters.estado !== "todas" && r.estado !== filters.estado) return false;
        return true;
      }),
    [rows, filters],
  );

  // El promedio ignora las pendientes: contarlas como 0 haría bajar la media
  // solo porque falta procesar hojas.
  const promedio = useMemo(() => {
    const conNota = visible.filter((r) => r.puntaje !== null);
    if (conNota.length === 0) return null;
    return Math.round((conNota.reduce((s, r) => s + r.puntaje!, 0) / conNota.length) * 10) / 10;
  }, [visible]);

  return (
    <>
      <PageHeader title={title} description={description} actions={actions} />

      <div className="space-y-3">
        <CalificacionesFilterRow
          filters={filters}
          onChange={setFilters}
          gradoOptions={gradoOptions}
          grupoOptions={grupoOptions}
          pruebaOptions={pruebaOptions}
          tipoOptions={tipoOptions}
        />

        <p className="text-muted-foreground text-sm">
          Mostrando {visible.length} de {rows.length} estudiantes
          {promedio !== null && <> · puntaje promedio {promedio}</>}
        </p>

        <div className="bg-card overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-xs font-medium tracking-wide uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Estudiante</th>
                <th className="px-3 py-2 text-left">Código</th>
                <th className="px-3 py-2 text-left">Grado</th>
                <th className="px-3 py-2 text-left">Grupo</th>
                <th className="px-3 py-2 text-left">Cuadernillo</th>
                <th className="px-3 py-2 text-left">Prueba</th>
                <th className="px-3 py-2 text-left">Tipo</th>
                <th className="px-3 py-2 text-left">Estado</th>
                <th className="px-3 py-2 text-right">Correctas</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">
                  <span className="sr-only">Historial</span>
                </th>
                <th className="px-3 py-2 text-right">
                  <span className="sr-only">Detalle</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={12} className="text-muted-foreground px-3 py-6 text-center text-sm">
                    {rows.length === 0
                      ? "No hay hojas identificadas en los grados a los que tienes acceso."
                      : "Ningún estudiante coincide con los filtros aplicados."}
                  </td>
                </tr>
              ) : (
                visible.map((r) => (
                  <tr key={r.sheetId} className="hover:bg-muted/20 border-t">
                    <td className="px-3 py-2 font-medium">{r.studentName}</td>
                    <td className="px-3 py-2 tabular-nums">{r.studentCode}</td>
                    <td className="px-3 py-2">{r.courseName}</td>
                    <td className="px-3 py-2">{r.groupName}</td>
                    <td className="px-3 py-2">{r.assessmentName}</td>
                    <td className="px-3 py-2">
                      {r.periodName ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {r.bookletTypeName ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          "rounded-md border px-2 py-0.5 text-xs font-medium " +
                          (r.estado === "calificada"
                            ? "border-green-600/40 bg-green-600/10 text-green-700"
                            : r.estado === "observaciones"
                              ? "border-amber-600/40 bg-amber-600/10 text-amber-700"
                              : "border-border text-muted-foreground")
                        }
                        title={
                          r.estado === "observaciones"
                            ? "Tiene puntaje, pero el motor marcó respuestas ambiguas: conviene revisar el papel"
                            : `Estado del escaneo: ${r.status}`
                        }
                      >
                        {etiquetaEstado(r.estado)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.totalCorrect ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.totalQuestions ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {/* El número dice de un vistazo quién tiene reescaneos:
                          es la señal de que hubo problemas con esa hoja. */}
                      <button
                        type="button"
                        onClick={() => setHistorial(r)}
                        className="text-muted-foreground hover:text-primary text-xs underline underline-offset-2"
                        title="Ver todas las hojas cargadas de este estudiante, con sus fechas"
                      >
                        Historial ({r.historial.length})
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {/* Discreto a propósito: la consulta es para leer en bloque,
                          el detalle es la excepción. Las hojas sin lote no tienen
                          pantalla a la que ir. */}
                      {r.batchId ? (
                        <Link
                          href={`/teacher/scan/${r.batchId}/${r.sheetId}/resumen?soloLectura=1&volver=${encodeURIComponent(
                            "/admin/consultas/calificaciones",
                          )}`}
                          className="text-muted-foreground hover:text-primary text-xs underline underline-offset-2"
                          title="Ver el desglose por asignatura; desde ahí se llega a la matriz de respuestas"
                        >
                          Ver detalle
                        </Link>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {historial && <HistorialModal fila={historial} onClose={() => setHistorial(null)} />}
    </>
  );
}
