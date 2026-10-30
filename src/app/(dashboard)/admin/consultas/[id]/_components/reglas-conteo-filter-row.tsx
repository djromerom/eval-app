"use client";

export interface ReglasConteoFilterState {
  /** "" = todas las pruebas. */
  periodId: string;
  /** "" = todos los grados. */
  courseName: string;
  /** "" = todas las asignaturas. */
  subjectName: string;
}

export const EMPTY_REGLAS_FILTERS: ReglasConteoFilterState = {
  periodId: "",
  courseName: "",
  subjectName: "",
};

export interface OpcionPrueba {
  id: string;
  name: string;
  year: number;
}

/** Filter row controlado de la consulta "Regla de conteo".
 *  El padre (`ReglasConteoTable`) maneja el state y pasa `filters` +
 *  `onChange` + las opciones (derivadas de las propias filas — sin fetch
 *  extra). */
export function ReglasConteoFilterRow({
  filters,
  onChange,
  pruebas,
  courseOptions,
  subjectOptions,
}: {
  filters: ReglasConteoFilterState;
  onChange: (next: ReglasConteoFilterState) => void;
  /** Pruebas que tienen al menos una regla. */
  pruebas: OpcionPrueba[];
  courseOptions: string[];
  subjectOptions: string[];
}) {
  return (
    <div className="bg-card flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm">
      <select
        value={filters.periodId}
        onChange={(e) => onChange({ ...filters, periodId: e.target.value })}
        className="border-input bg-background focus-visible:border-primary focus-visible:ring-primary/20 rounded-md border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-hidden"
        aria-label="Filtrar por prueba"
      >
        <option value="">Todas las pruebas</option>
        {pruebas.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.year})
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
    </div>
  );
}
