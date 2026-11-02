"use client";

import { useMemo } from "react";
import type { EvaluationStatus } from "@/modules/evaluations/domain/evaluation-status";
import type { PruebaOpcion } from "@/modules/consultas/domain/shared/prueba-opcion";

export interface FormulacionesFilterState {
  search: string;
  subjectName: string; // "" = todas
  courseName: string; // "" = todos
  periodId: string; // "" = todas
  academicYearYear: number | null; // null = todos
  status: EvaluationStatus | ""; // "" = todos
}

export const EMPTY_FILTERS: FormulacionesFilterState = {
  search: "",
  subjectName: "",
  courseName: "",
  periodId: "",
  academicYearYear: null,
  status: "",
};

/** Estado inicial de los filtros: todo abierto salvo la prueba, que arranca
 *  en la que está en curso (`defaultPeriodId`). `null` = ninguna prueba
 *  marcada como actual → el filtro queda en "todas las pruebas". */
export function filtrosIniciales(defaultPeriodId: string | null): FormulacionesFilterState {
  return { ...EMPTY_FILTERS, periodId: defaultPeriodId ?? "" };
}

/** Filter row controlado. El padre (`FormulacionesTable`) maneja el state y
 *  pasa `filters` + `onChange` + `lookups` (los valores disponibles se
 *  derivan de las propias filas — sin fetch extra). */
export function FormulacionesFilterRow({
  filters,
  onChange,
  subjectOptions,
  courseOptions,
  periodOptions,
  yearOptions,
}: {
  filters: FormulacionesFilterState;
  onChange: (next: FormulacionesFilterState) => void;
  /** Opciones derivadas de las filas actuales; ya dedupeadas y ordenadas. */
  subjectOptions: string[];
  courseOptions: string[];
  /** Pruebas de la institución (vienen del servidor, no de las filas). */
  periodOptions: PruebaOpcion[];
  yearOptions: number[];
}) {
  const yearLabel = useMemo(() => {
    return (y: number | null) => (y == null ? "Todos los años" : String(y));
  }, []);

  return (
    <div className="bg-card flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm">
      <input
        type="search"
        value={filters.search}
        onChange={(e) => onChange({ ...filters, search: e.target.value })}
        placeholder="Buscar por título, asignatura o docente…"
        className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20 min-w-[16ch] flex-1 rounded-md border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-hidden"
        aria-label="Buscar"
      />
      <select
        value={filters.subjectName}
        onChange={(e) => onChange({ ...filters, subjectName: e.target.value })}
        className="border-input bg-background focus-visible:border-primary focus-visible:ring-primary/20 rounded-md border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-hidden"
        aria-label="Filtrar por asignatura"
      >
        <option value="">Todas las asignaturas</option>
        {subjectOptions.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <select
        value={filters.courseName}
        onChange={(e) => onChange({ ...filters, courseName: e.target.value })}
        className="border-input bg-background focus-visible:border-primary focus-visible:ring-primary/20 rounded-md border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-hidden"
        aria-label="Filtrar por grado"
      >
        <option value="">Todos los grados</option>
        {courseOptions.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select
        value={filters.periodId}
        onChange={(e) => onChange({ ...filters, periodId: e.target.value })}
        className="border-input bg-background focus-visible:border-primary focus-visible:ring-primary/20 rounded-md border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-hidden"
        aria-label="Filtrar por prueba"
      >
        <option value="">Todas las pruebas</option>
        {periodOptions.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.year})
          </option>
        ))}
      </select>
      <select
        value={filters.academicYearYear ?? ""}
        onChange={(e) =>
          onChange({
            ...filters,
            academicYearYear: e.target.value ? Number(e.target.value) : null,
          })
        }
        className="border-input bg-background focus-visible:border-primary focus-visible:ring-primary/20 rounded-md border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-hidden"
        aria-label="Filtrar por año"
      >
        <option value="">{yearLabel(null)}</option>
        {yearOptions.map((y) => (
          <option key={y} value={y}>
            {yearLabel(y)}
          </option>
        ))}
      </select>
      <select
        value={filters.status}
        onChange={(e) =>
          onChange({
            ...filters,
            status: e.target.value as FormulacionesFilterState["status"],
          })
        }
        className="border-input bg-background focus-visible:border-primary focus-visible:ring-primary/20 rounded-md border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-hidden"
        aria-label="Filtrar por estado"
      >
        <option value="">Todos los estados</option>
        <option value="DRAFT">Borrador</option>
        <option value="IN_REVIEW">En revisión</option>
        <option value="APPROVED">Aprobada</option>
        <option value="PUBLISHED">Publicada</option>
      </select>
    </div>
  );
}
