/**
 * Botón cliente "Descargar XLSX" — exporta el conjunto **filtrado**
 * actualmente en la UI. Construye el query string desde los filtros
 * activos (mismos campos que `FormulacionesFilterRow`) y emite un GET a
 * `/admin/consultas/formulaciones/export.xlsx?...`.
 *
 * Vive como client component porque necesita acceso a los mismos `useState`
 * que el filter row (lift state up en `FormulacionesTable`). El `<a>` con
 * `download` permite que el browser haga la descarga sin JS adicional.
 */
"use client";

import { usePathname } from "next/navigation";
import type { FormulacionesFilterState } from "./formulaciones-filter-row";

function buildQuery(f: FormulacionesFilterState): string {
  const params = new URLSearchParams();
  if (f.search.trim()) params.set("search", f.search.trim());
  if (f.subjectName) params.set("subject", f.subjectName);
  if (f.courseName) params.set("course", f.courseName);
  if (f.academicYearYear != null) params.set("year", String(f.academicYearYear));
  if (f.status) params.set("status", f.status);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function DownloadXlsxButton({ filters }: { filters: FormulacionesFilterState }) {
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
