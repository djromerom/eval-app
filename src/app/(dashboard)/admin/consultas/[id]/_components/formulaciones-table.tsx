"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { FormulacionRow } from "@/modules/consultas/domain/queries/formulaciones/formulacion-row";
import type { AsignacionPendiente } from "@/modules/consultas/domain/queries/formulaciones/asignacion-pendiente";
import {
  applyFormulacionesFilters,
  applyPendientesFilters,
  type FormulacionesFilters,
} from "@/modules/consultas/domain/queries/formulaciones/filters";
import type { PruebaOpcion } from "@/modules/consultas/domain/shared/prueba-opcion";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/evaluations/status-badge";
import {
  filtrosIniciales,
  FormulacionesFilterRow,
  type FormulacionesFilterState,
} from "./formulaciones-filter-row";
import { ItemsBadgeCell } from "./items-badge-cell";
import { EstadoSinFormularBadge } from "./estado-sin-formular-badge";
import { DownloadXlsxButton } from "./download-xlsx-button";

/** Componente cliente que renderiza el listado completo de la consulta
 *  "Listado de Formulaciones": PageHeader + filtro + tabla + botón XLSX.
 *
 *  Aunque el nombre sugiere "table", hace de wrapper cliente porque el
 *  botón de descarga (en el slot `actions` del PageHeader) necesita acceso
 *  al mismo `useState` de filtros que el filter row — mover el state arriba
 *  evitaría un Context/portal adicional.
 *
 *  Sin paginación: el módulo consultas asume ≤ 300 filas por institución
 *  (datasets reales observados). Si crece, se evoluciona a searchParams-driven
 *  como `/coordinator/review` sin tocar el dominio.
 */
export function FormulacionesTable({
  rows,
  pendientes,
  title,
  description,
  actions,
  pruebas,
  defaultPeriodId,
}: {
  rows: FormulacionRow[];
  /** Asignaciones de las pruebas que aún no tienen formulación (las que las
   *  reglas de conteo o las asignaciones docente exigen). Se listan al
   *  final, en muted. */
  pendientes: AsignacionPendiente[];
  /** Título del PageHeader (viene del registry: `consulta.title`). */
  title: string;
  /** Descripción del PageHeader. */
  description: ReactNode;
  /** Slot adicional de actions (futuro: "Nuevo", "Imprimir", etc.). El botón
   *  "Descargar XLSX" se añade SIEMPRE al lado derecho por este componente. */
  actions?: ReactNode;
  /** Pruebas de la institución: opciones del filtro "Prueba". */
  pruebas: PruebaOpcion[];
  /** Prueba preseleccionada en el filtro (la que está en curso). `null` = el
   *  filtro queda en "todas las pruebas". */
  defaultPeriodId: string | null;
}) {
  // El filtro de prueba arranca en la prueba en curso: es la que el admin
  // está mirando normalmente. `defaultPeriodId` es `null` cuando ninguna
  // prueba está marcada como actual.
  const [filters, setFilters] = useState<FormulacionesFilterState>(() =>
    filtrosIniciales(defaultPeriodId),
  );

  /**
   * Pruebas que entran en el filtro:
   *   - sin selección → todas;
   *   - con selección → solo la elegida.
   */
  const selectedPeriodIds = useMemo<string[] | null>(
    () => (filters.periodId ? [filters.periodId] : null),
    [filters.periodId],
  );

  // Lookups: derivamos opciones de filtro de las propias filas (sin fetch).
  // Las asignaciones pendientes también aportan sus asignaturas y grados:
  // si una asignatura aún no está formulada, igual debe poder filtrarse.
  const { subjectOptions, courseOptions, yearOptions } = useMemo(() => {
    const subjects = new Set<string>();
    const courses = new Set<string>();
    const years = new Set<number>();
    for (const r of rows) {
      subjects.add(r.subjectName);
      courses.add(r.courseName);
      years.add(r.academicYearYear);
    }
    for (const p of pendientes) {
      subjects.add(p.subjectName);
      courses.add(p.courseName);
      years.add(p.academicYearYear);
    }
    return {
      subjectOptions: Array.from(subjects).sort((a, b) => a.localeCompare(b, "es")),
      courseOptions: Array.from(courses).sort((a, b) => a.localeCompare(b, "es")),
      yearOptions: Array.from(years).sort((a, b) => b - a),
    };
  }, [rows, pendientes]);

  /**
   * Filtros en el formato del dominio. Se usan las MISMAS funciones que el
   * export XLSX (`applyFormulacionesFilters` / `applyPendientesFilters`), así
   * lo que se ve en pantalla y lo que baja el Excel no pueden divergir.
   */
  const filtros = useMemo<FormulacionesFilters>(
    () => ({
      search: filters.search || undefined,
      subjectName: filters.subjectName || undefined,
      courseName: filters.courseName || undefined,
      periodIds: selectedPeriodIds ?? undefined,
      academicYearYear: filters.academicYearYear ?? undefined,
      status: filters.status || undefined,
    }),
    [filters, selectedPeriodIds],
  );

  const visible = useMemo(() => applyFormulacionesFilters(rows, filtros), [rows, filtros]);
  const visiblePendientes = useMemo(
    () => applyPendientesFilters(pendientes, filtros),
    [pendientes, filtros],
  );

  const fmtDate = (d: Date) =>
    d.toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "2-digit" });

  // Contador del listado: las formulaciones que se ven + las asignaciones
  // pendientes que la prueba exige y que aún no están formuladas.
  const resumen = `Mostrando ${visible.length} de ${rows.length} formulaciones`;
  const resumenPendientes =
    visiblePendientes.length > 0 ? " · " + visiblePendientes.length + " sin formular" : "";

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            {actions}
            <DownloadXlsxButton filters={filters} periodIds={selectedPeriodIds} />
          </>
        }
      />

      <div className="space-y-3">
        <FormulacionesFilterRow
          filters={filters}
          onChange={setFilters}
          subjectOptions={subjectOptions}
          courseOptions={courseOptions}
          periodOptions={pruebas}
          yearOptions={yearOptions}
        />

        <p className="text-muted-foreground text-sm">
          {resumen}
          {resumenPendientes}
        </p>

        <div className="bg-card overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-xs font-medium tracking-wide uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Asignatura</th>
                <th className="px-3 py-2 text-left">Grado</th>
                <th className="px-3 py-2 text-left">Año</th>
                <th className="px-3 py-2 text-left">Prueba</th>
                <th className="px-3 py-2 text-left">Tipo</th>
                <th className="px-3 py-2 text-left">Estado</th>
                <th className="px-3 py-2 text-left">Items</th>
                <th className="px-3 py-2 text-left">Autor</th>
                <th className="px-3 py-2 text-left">Asignados</th>
                <th className="px-3 py-2 text-left">Actualizado</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && visiblePendientes.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-muted-foreground px-3 py-6 text-center text-sm">
                    {rows.length === 0
                      ? "No hay formulaciones registradas en la institución."
                      : "Ninguna formulación coincide con los filtros aplicados."}
                  </td>
                </tr>
              ) : (
                <>
                  {visible.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/20 border-t">
                      <td className="px-3 py-2 font-medium">{r.subjectName}</td>
                      <td className="px-3 py-2">{r.courseName}</td>
                      <td className="px-3 py-2 tabular-nums">{r.academicYearYear}</td>
                      <td className="px-3 py-2">
                        {r.periodName ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {r.bookletTypeName ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-3 py-2">
                        <ItemsBadgeCell
                          total={r.itemsTotal}
                          expected={r.itemsExpected}
                          badge={r.itemsBadge}
                        />
                      </td>
                      <td className="px-3 py-2">{r.authorName}</td>
                      <td className="text-muted-foreground px-3 py-2">
                        {r.assignedTeachers.length === 0 ? (
                          <span aria-label="Sin docentes asignados">—</span>
                        ) : (
                          <span title={r.assignedTeachers.join(", ")}>
                            {r.assignedTeachers.slice(0, 3).join(", ")}
                            {r.assignedTeachers.length > 3
                              ? ` +${r.assignedTeachers.length - 3}`
                              : ""}
                          </span>
                        )}
                      </td>
                      <td className="text-muted-foreground px-3 py-2 text-xs tabular-nums">
                        {fmtDate(r.updatedAt)}
                      </td>
                    </tr>
                  ))}

                  {/* Asignaciones de la prueba que aún no tienen formulación:
                      las reglas de conteo y las asignaciones docente las
                      exigen y todavía nadie las formuló. Van al final y en
                      muted para distinguirlas de las formulaciones. */}
                  {visiblePendientes.map((p) => (
                    <tr key={p.id} className="text-muted-foreground hover:bg-muted/20 border-t">
                      <td className="px-3 py-2 font-medium">{p.subjectName}</td>
                      <td className="px-3 py-2">{p.courseName}</td>
                      <td className="px-3 py-2 tabular-nums">{p.academicYearYear}</td>
                      <td className="px-3 py-2">{p.periodName}</td>
                      <td className="px-3 py-2">
                        {p.bookletTypeName ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <EstadoSinFormularBadge />
                      </td>
                      <td className="px-3 py-2">
                        <ItemsBadgeCell
                          total={0}
                          expected={p.itemsExpected}
                          badge={p.itemsExpected == null ? "none" : "low"}
                        />
                      </td>
                      <td className="px-3 py-2">—</td>
                      <td className="px-3 py-2">
                        {p.assignedTeachers.length === 0 ? (
                          <span aria-label="Sin docentes asignados">—</span>
                        ) : (
                          <span title={p.assignedTeachers.join(", ")}>
                            {p.assignedTeachers.slice(0, 3).join(", ")}
                            {p.assignedTeachers.length > 3
                              ? ` +${p.assignedTeachers.length - 3}`
                              : ""}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs tabular-nums">—</td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
