"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ALL_PERIODS } from "@/modules/academic/domain/period-filter";

interface PeriodOption {
  id: string;
  name: string;
}

interface BookletTypeOption {
  id: string;
  periodId: string;
  name: string;
}

interface StatusOption {
  value: string;
  label: string;
}

/**
 * Fila de filtros del listado de cuadernillos (Sprint Bundle-Period, sep 2026).
 *
 * Filtros via `?periodId=...&bookletTypeId=...&status=...` (searchParams), mismo
 * patrón que `/coordinator/review`. La URL es la fuente de verdad: back-button,
 * compartible, sin perder scroll.
 *
 * Cascada Period → BookletType: si cambia el Period, los BookletTypes se filtran
 * a los del nuevo Period. Si el bookletTypeId actual no pertenece al Period
 * seleccionado, el select se resetea (es coherente con la restricción del
 * use case en server).
 *
 * Los BookletTypes que NO pertenecen a ningún Period en el filtro se mantienen
 * visibles si no hay Period seleccionado (caso "todos los Tipos").
 */
export function BundlesFilterRow({
  periods,
  bookletTypes,
  statuses,
  currentPeriodId,
  currentBookletTypeId,
  currentStatus,
}: {
  periods: PeriodOption[];
  bookletTypes: BookletTypeOption[];
  statuses: StatusOption[];
  currentPeriodId: string;
  currentBookletTypeId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function navigate(next: { periodId?: string; bookletTypeId?: string; status?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.periodId !== undefined) {
      if (next.periodId === "") params.delete("periodId");
      else params.set("periodId", next.periodId);
    }
    if (next.bookletTypeId !== undefined) {
      if (next.bookletTypeId === "") params.delete("bookletTypeId");
      else params.set("bookletTypeId", next.bookletTypeId);
    }
    if (next.status !== undefined) {
      if (next.status === "") params.delete("status");
      else params.set("status", next.status);
    }
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `/admin/bundles?${qs}` : "/admin/bundles");
    });
  }

  // BookletTypes disponibles: si hay Period seleccionado, solo los de ese Period.
  const filteredTypes = currentPeriodId
    ? bookletTypes.filter((bt) => bt.periodId === currentPeriodId)
    : bookletTypes;

  const selectClass =
    "border-input bg-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none";

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm">
        <span className="font-medium">Prueba</span>
        <select
          aria-label="Filtrar por Prueba"
          className={selectClass}
          value={currentPeriodId || ALL_PERIODS}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.value;
            // Si cambia el Period, reseteamos el BookletType si ya no es válido
            // en el nuevo Period. Caso edge: si el usuario eligió un BookletType
            // y luego cambia a un Period distinto, ese BookletType deja de aplicar.
            const stillValid =
              !currentBookletTypeId ||
              next === ALL_PERIODS ||
              !next ||
              bookletTypes.find((bt) => bt.id === currentBookletTypeId && bt.periodId === next);
            navigate({
              periodId: next,
              bookletTypeId: stillValid ? currentBookletTypeId : "",
            });
          }}
        >
          <option value={ALL_PERIODS}>Todas</option>
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <span className="font-medium">Tipo</span>
        <select
          aria-label="Filtrar por Tipo de cuadernillo"
          className={selectClass}
          value={currentBookletTypeId}
          disabled={pending || filteredTypes.length === 0}
          onChange={(e) => navigate({ bookletTypeId: e.target.value })}
        >
          <option value="">{currentPeriodId ? "Todos" : "Todos"}</option>
          {filteredTypes.map((bt) => (
            <option key={bt.id} value={bt.id}>
              {bt.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <span className="font-medium">Estado</span>
        <select
          aria-label="Filtrar por Estado"
          className={selectClass}
          value={currentStatus}
          disabled={pending}
          onChange={(e) => navigate({ status: e.target.value })}
        >
          <option value="">Todos</option>
          {statuses.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
