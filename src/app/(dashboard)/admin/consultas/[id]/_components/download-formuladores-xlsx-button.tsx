/**
 * Botón cliente "Descargar XLSX" de la consulta "Docentes formuladores":
 * exporta el conjunto **filtrado** actualmente en la UI. Construye el query
 * string desde los filtros activos y emite un GET a
 * `/admin/consultas/formuladores/export.xlsx?...`.
 *
 * El `<a>` con `download` permite que el browser haga la descarga sin JS
 * adicional.
 */
"use client";

import { usePathname } from "next/navigation";
import type { FormuladoresFilterState } from "./formuladores-filter-row";

function buildQuery(f: FormuladoresFilterState): string {
  const params = new URLSearchParams();
  if (f.search.trim()) params.set("search", f.search.trim());
  if (f.cuadernillo) params.set("cuadernillo", f.cuadernillo);
  if (f.grado) params.set("grado", f.grado);
  if (f.asignatura) params.set("asignatura", f.asignatura);
  if (f.estado) params.set("estado", f.estado);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function DownloadFormuladoresXlsxButton({ filters }: { filters: FormuladoresFilterState }) {
  const pathname = usePathname();
  const href = `${pathname}/export.xlsx${buildQuery(filters)}`;
  return (
    <a
      href={href}
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
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 2v8m0 0 3-3m-3 3-3-3M3 13h10" />
      </svg>
      Descargar XLSX
    </a>
  );
}
