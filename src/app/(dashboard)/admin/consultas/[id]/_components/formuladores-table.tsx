"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ESTADO_LABEL,
  SIN_DATO,
  pruebaLabel,
  type FormuladorRow,
} from "@/modules/consultas/domain/queries/formuladores/formulador-row";
import {
  applyFormuladoresFilters,
  type FormuladoresFilters,
} from "@/modules/consultas/domain/queries/formuladores/filters";
import { PageHeader } from "@/components/page-header";
import {
  EMPTY_FORMULADORES_FILTERS,
  FormuladoresFilterRow,
  type FormuladoresFilterState,
} from "./formuladores-filter-row";
import { DownloadFormuladoresXlsxButton } from "./download-formuladores-xlsx-button";

/** Componente cliente que renderiza la consulta "Docentes formuladores por
 *  cuadernillo": PageHeader + filtros + tabla + botón XLSX.
 *
 *  Es wrapper cliente porque el botón de descarga (en el slot `actions` del
 *  PageHeader) necesita acceso al mismo `useState` de filtros que el filter
 *  row.
 *
 *  Sin paginación: igual que el resto de consultas del módulo (el dataset
 *  es el de asignaciones + formulaciones de la institución).
 */
export function FormuladoresTable({
  rows,
  title,
  description,
  actions,
}: {
  rows: FormuladorRow[];
  /** Título del PageHeader (viene del registry: `consulta.title`). */
  title: string;
  /** Descripción del PageHeader. */
  description: ReactNode;
  /** Slot adicional de actions. El botón "Descargar XLSX" se añade SIEMPRE
   *  al lado derecho por este componente. */
  actions?: ReactNode;
}) {
  const [filters, setFilters] = useState<FormuladoresFilterState>(EMPTY_FORMULADORES_FILTERS);

  // Lookups: derivamos opciones de filtro de las filas mismas (sin fetch).
  const { cuadernilloOptions, gradoOptions, asignaturaOptions } = useMemo(() => {
    const cuadernillos = new Set<string>();
    const grados = new Set<string>();
    const asignaturas = new Set<string>();
    for (const r of rows) {
      cuadernillos.add(r.cuadernillo);
      grados.add(r.grado);
      asignaturas.add(r.asignatura);
    }
    const col = (a: string, b: string) => a.localeCompare(b, "es");
    return {
      cuadernilloOptions: Array.from(cuadernillos).sort(col),
      gradoOptions: Array.from(grados).sort(col),
      asignaturaOptions: Array.from(asignaturas).sort(col),
    };
  }, [rows]);

  // El filtro de la UI (todas las opciones) se traduce al bag de filtros del
  // dominio — el mismo que aplica el export en el servidor.
  const filtros = useMemo<FormuladoresFilters>(() => {
    const f: FormuladoresFilters = {};
    if (filters.search.trim()) f.search = filters.search.trim();
    if (filters.cuadernillo) f.cuadernillo = filters.cuadernillo;
    if (filters.grado) f.grado = filters.grado;
    if (filters.asignatura) f.asignatura = filters.asignatura;
    if (filters.estado) f.estado = filters.estado;
    return f;
  }, [filters]);

  const visible = useMemo(() => applyFormuladoresFilters(rows, filtros), [rows, filtros]);

  const celda = (valor: string | null) =>
    valor ? valor : <span className="text-muted-foreground">{SIN_DATO}</span>;

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            {actions}
            <DownloadFormuladoresXlsxButton filters={filters} />
          </>
        }
      />

      <div className="space-y-3">
        <FormuladoresFilterRow
          filters={filters}
          onChange={setFilters}
          cuadernilloOptions={cuadernilloOptions}
          gradoOptions={gradoOptions}
          asignaturaOptions={asignaturaOptions}
        />

        <p className="text-muted-foreground text-sm">
          Mostrando {visible.length} de {rows.length} filas
        </p>

        <div className="bg-card overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-xs font-medium tracking-wide uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Cuadernillo</th>
                <th className="px-3 py-2 text-left">Grado</th>
                <th className="px-3 py-2 text-left">Asignatura</th>
                <th className="px-3 py-2 text-left">Formulador</th>
                <th className="px-3 py-2 text-left">Prueba</th>
                <th className="px-3 py-2 text-left">Formulación</th>
                <th className="px-3 py-2 text-left">Estado</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-muted-foreground px-3 py-6 text-center text-sm">
                    {rows.length === 0
                      ? "No hay docentes asignados ni formulaciones registradas en la institución."
                      : "Ninguna fila coincide con los filtros aplicados."}
                  </td>
                </tr>
              ) : (
                visible.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/20 border-t">
                    <td className="px-3 py-2 font-medium">{r.cuadernillo}</td>
                    <td className="px-3 py-2">{r.grado}</td>
                    <td className="px-3 py-2">{r.asignatura}</td>
                    <td className="px-3 py-2">{r.formulador}</td>
                    <td className="text-muted-foreground px-3 py-2 text-xs">
                      {r.prueba || r.anio ? pruebaLabel(r) : <span>{SIN_DATO}</span>}
                    </td>
                    <td className="text-muted-foreground px-3 py-2 text-xs">
                      {celda(r.formulacion)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          "rounded-md border px-2 py-0.5 text-xs font-medium " +
                          (r.estado === "formulado"
                            ? "border-green-600/40 bg-green-600/10 text-green-700"
                            : r.estado === "formulado-por-otro"
                              ? "border-amber-600/40 bg-amber-600/10 text-amber-700"
                              : "border-border text-muted-foreground")
                        }
                      >
                        {ESTADO_LABEL[r.estado]}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
