"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import type { ReglaConteoRow } from "@/modules/consultas/domain/queries/reglas-conteo/regla-conteo-row";
import {
  EMPTY_REGLAS_FILTERS,
  ReglasConteoFilterRow,
  type ReglasConteoFilterState,
} from "./reglas-conteo-filter-row";
import { DownloadReglasXlsxButton } from "./download-reglas-xlsx-button";

/** Componente cliente que renderiza la consulta "Reglas de conteo por
 *  prueba": PageHeader + filtro + tabla + botón XLSX.
 *
 *  Una fila por REGLA de conteo (Prueba × Grado × Asignatura × Tipo de
 *  cuadernillo), con el número exacto de ítems que exige y cuántos ítems se
 *  han formulado ya para esa regla.
 *
 *  Sin paginación: el módulo consultas asume ≤ 300 filas por institución
 *  (las reglas son aún menos: una por tupla configurada).
 */
export function ReglasConteoTable({
  rows,
  title,
  description,
  actions,
}: {
  rows: ReglaConteoRow[];
  title: string;
  description: ReactNode;
  actions?: ReactNode;
}) {
  const [filters, setFilters] = useState<ReglasConteoFilterState>(EMPTY_REGLAS_FILTERS);

  // Lookups: derivamos opciones de filtro de las filas mismas (sin fetch).
  const { pruebas, courseOptions, subjectOptions } = useMemo(() => {
    const byPeriod = new Map<string, { id: string; name: string; year: number }>();
    const courses = new Set<string>();
    const subjects = new Set<string>();
    for (const r of rows) {
      byPeriod.set(r.periodId, { id: r.periodId, name: r.periodName, year: r.academicYearYear });
      courses.add(r.courseName);
      subjects.add(r.subjectName);
    }
    return {
      pruebas: Array.from(byPeriod.values()).sort(
        (a, b) => b.year - a.year || a.name.localeCompare(b.name, "es"),
      ),
      courseOptions: Array.from(courses).sort((a, b) => a.localeCompare(b, "es")),
      subjectOptions: Array.from(subjects).sort((a, b) => a.localeCompare(b, "es")),
    };
  }, [rows]);

  const visible = useMemo(() => {
    return rows.filter((r) => {
      if (filters.periodId && r.periodId !== filters.periodId) return false;
      if (filters.courseName && r.courseName !== filters.courseName) return false;
      if (filters.subjectName && r.subjectName !== filters.subjectName) return false;
      return true;
    });
  }, [rows, filters]);

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            {actions}
            <DownloadReglasXlsxButton filters={filters} />
          </>
        }
      />

      <div className="space-y-3">
        <ReglasConteoFilterRow
          filters={filters}
          onChange={setFilters}
          pruebas={pruebas}
          courseOptions={courseOptions}
          subjectOptions={subjectOptions}
        />

        <p className="text-muted-foreground text-sm">
          Mostrando {visible.length} de {rows.length} reglas de conteo
        </p>

        <div className="bg-card overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-xs font-medium tracking-wide uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Prueba</th>
                <th className="px-3 py-2 text-left">Año</th>
                <th className="px-3 py-2 text-left">Grado</th>
                <th className="px-3 py-2 text-left">Asignatura</th>
                <th className="px-3 py-2 text-left">Tipo</th>
                <th className="px-3 py-2 text-left">Conteo de ítems</th>
                <th className="px-3 py-2 text-left">Formuladas</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-muted-foreground px-3 py-6 text-center text-sm">
                    {rows.length === 0
                      ? "No hay reglas de conteo configuradas en la institución."
                      : "Ninguna regla coincide con los filtros aplicados."}
                  </td>
                </tr>
              ) : (
                visible.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/20 border-t">
                    <td className="px-3 py-2 font-medium">{r.periodName}</td>
                    <td className="px-3 py-2 tabular-nums">{r.academicYearYear}</td>
                    <td className="px-3 py-2">{r.courseName}</td>
                    <td className="px-3 py-2">{r.subjectName}</td>
                    <td className="px-3 py-2">{r.bookletTypeName}</td>
                    <td className="px-3 py-2 tabular-nums">{r.exactQuestions}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {r.itemsFormulados === 0 ? (
                        <span aria-label="Sin ítems formulados">—</span>
                      ) : (
                        r.itemsFormulados
                      )}
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
