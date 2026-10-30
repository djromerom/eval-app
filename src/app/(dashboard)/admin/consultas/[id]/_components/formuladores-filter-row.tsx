"use client";

import type { EstadoCobertura } from "@/modules/consultas/domain/queries/formuladores/formulador-row";

/** Estado de los filtros en la UI. `""` = sin filtro (todas las opciones). */
export interface FormuladoresFilterState {
  search: string;
  cuadernillo: string;
  grado: string;
  asignatura: string;
  estado: EstadoCobertura | "";
}

export const EMPTY_FORMULADORES_FILTERS: FormuladoresFilterState = {
  search: "",
  cuadernillo: "",
  grado: "",
  asignatura: "",
  estado: "",
};

/** Filter row controlado. El padre (`FormuladoresTable`) maneja el state y
 *  pasa `filters` + `onChange` + las opciones (derivadas de las propias
 *  filas — sin fetch extra). */
export function FormuladoresFilterRow({
  filters,
  onChange,
  cuadernilloOptions,
  gradoOptions,
  asignaturaOptions,
}: {
  filters: FormuladoresFilterState;
  onChange: (next: FormuladoresFilterState) => void;
  /** Opciones derivadas de las filas actuales; ya dedupeadas y ordenadas. */
  cuadernilloOptions: string[];
  gradoOptions: string[];
  asignaturaOptions: string[];
}) {
  return (
    <div className="bg-card flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm">
      <input
        type="search"
        value={filters.search}
        onChange={(e) => onChange({ ...filters, search: e.target.value })}
        placeholder="Buscar por docente, cuadernillo, grado o correo…"
        className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20 min-w-[16ch] flex-1 rounded-md border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-hidden"
        aria-label="Buscar"
      />
      <select
        value={filters.cuadernillo}
        onChange={(e) => onChange({ ...filters, cuadernillo: e.target.value })}
        className="border-input bg-background focus-visible:border-primary focus-visible:ring-primary/20 rounded-md border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-hidden"
        aria-label="Filtrar por cuadernillo"
      >
        <option value="">Todos los cuadernillos</option>
        {cuadernilloOptions.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select
        value={filters.grado}
        onChange={(e) => onChange({ ...filters, grado: e.target.value })}
        className="border-input bg-background focus-visible:border-primary focus-visible:ring-primary/20 rounded-md border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-hidden"
        aria-label="Filtrar por grado"
      >
        <option value="">Todos los grados</option>
        {gradoOptions.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>
      <select
        value={filters.asignatura}
        onChange={(e) => onChange({ ...filters, asignatura: e.target.value })}
        className="border-input bg-background focus-visible:border-primary focus-visible:ring-primary/20 rounded-md border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-hidden"
        aria-label="Filtrar por asignatura"
      >
        <option value="">Todas las asignaturas</option>
        {asignaturaOptions.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      <select
        value={filters.estado}
        onChange={(e) =>
          onChange({ ...filters, estado: e.target.value as FormuladoresFilterState["estado"] })
        }
        className="border-input bg-background focus-visible:border-primary focus-visible:ring-primary/20 rounded-md border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-hidden"
        aria-label="Filtrar por estado"
      >
        <option value="">Todos los estados</option>
        <option value="formulado">Formulado</option>
        <option value="formulado-por-otro">Formulado por otro</option>
        <option value="pendiente">Pendiente</option>
      </select>
    </div>
  );
}
