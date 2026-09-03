"use client";

import { useMemo, useState } from "react";
import type { FormulacionRow } from "@/modules/consultas/domain/queries/formulaciones/formulacion-row";
import { StatusBadge } from "@/components/evaluations/status-badge";
import {
  EMPTY_FILTERS,
  FormulacionesFilterRow,
  type FormulacionesFilterState,
} from "./formulaciones-filter-row";
import { ItemsBadgeCell } from "./items-badge-cell";

/** Componente cliente que renderiza el listado de formulaciones. Mantiene
 *  los filtros en `useState` y aplica `applyFormulacionesFilters` sobre el
 *  array de filas que llegó del servidor.
 *
 *  Sin paginación: el módulo consultas asume ≤ 300 filas por institución
 *  (datasets reales observados). Si crece, se evoluciona a searchParams-driven
 *  como `/coordinator/review` sin tocar el dominio.
 */
export function FormulacionesTable({ rows }: { rows: FormulacionRow[] }) {
  const [filters, setFilters] = useState<FormulacionesFilterState>(EMPTY_FILTERS);

  // Lookups: derivamos opciones de filtro de las filas mismas (sin fetch).
  const { subjectOptions, yearOptions } = useMemo(() => {
    const subjects = new Set<string>();
    const years = new Set<number>();
    for (const r of rows) {
      subjects.add(r.subjectName);
      years.add(r.academicYearYear);
    }
    return {
      subjectOptions: Array.from(subjects).sort((a, b) => a.localeCompare(b, "es")),
      yearOptions: Array.from(years).sort((a, b) => b - a),
    };
  }, [rows]);

  const visible = useMemo(() => {
    const term = filters.search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filters.subjectName && r.subjectName !== filters.subjectName) return false;
      if (filters.academicYearYear && r.academicYearYear !== filters.academicYearYear) return false;
      if (filters.status && r.status !== filters.status) return false;
      if (term) {
        const haystack = `${r.title} ${r.subjectName} ${r.authorName}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [rows, filters]);

  const fmtDate = (d: Date) =>
    d.toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "2-digit" });

  return (
    <div className="space-y-3">
      <FormulacionesFilterRow
        filters={filters}
        onChange={setFilters}
        subjectOptions={subjectOptions}
        yearOptions={yearOptions}
      />

      <p className="text-muted-foreground text-sm">
        Mostrando {visible.length} de {rows.length} formulaciones
      </p>

      <div className="bg-card overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground text-xs font-medium tracking-wide uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Asignatura</th>
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
            {visible.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-muted-foreground px-3 py-6 text-center text-sm">
                  {rows.length === 0
                    ? "No hay formulaciones registradas en la institución."
                    : "Ninguna formulación coincide con los filtros aplicados."}
                </td>
              </tr>
            ) : (
              visible.map((r) => (
                <tr key={r.id} className="hover:bg-muted/20 border-t">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.subjectName}</div>
                    <div className="text-muted-foreground text-xs">{r.courseName}</div>
                  </td>
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
                        {r.assignedTeachers.length > 3 ? ` +${r.assignedTeachers.length - 3}` : ""}
                      </span>
                    )}
                  </td>
                  <td className="text-muted-foreground px-3 py-2 text-xs tabular-nums">
                    {fmtDate(r.updatedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
