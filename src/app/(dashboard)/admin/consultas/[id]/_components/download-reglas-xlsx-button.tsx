/**
 * Botón cliente "Descargar XLSX" de la consulta de reglas de conteo —
 * exporta el conjunto **filtrado** actualmente en la UI. Construye el query
 * string desde los filtros activos y emite un GET a
 * `/admin/consultas/reglas-conteo/export.xlsx?...`.
 *
 * Vive como client component porque necesita acceso a los mismos `useState`
 * que el filter row (lift state up en `ReglasConteoTable`).
 */
"use client";

import { usePathname } from "next/navigation";
import type { ReglasConteoFilterState } from "./reglas-conteo-filter-row";

function buildQuery(f: ReglasConteoFilterState): string {
  const params = new URLSearchParams();
  if (f.periodId) params.set("prueba", f.periodId);
  if (f.courseName) params.set("grado", f.courseName);
  if (f.subjectName) params.set("asignatura", f.subjectName);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function DownloadReglasXlsxButton({ filters }: { filters: ReglasConteoFilterState }) {
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
