"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ALL_PERIODS } from "@/modules/academic/domain/period-filter";

interface PeriodOption {
  id: string;
  name: string;
}

/**
 * Filtro de Prueba del módulo de escaneo (nov 2026).
 *
 * Mismo patrón que la fila de filtros de Cuadernillos: el filtro vive en la
 * URL (`?periodId=...`) y el listado arranca en la PRUEBA ACTUAL. "Todas" usa
 * el centinela `all` para poder distinguished de "no vino filtro".
 *
 * El filtro alcanza a las DOS listas de la página: los objetivos de escaneo
 * (formulaciones y cuadernillos) y los lotes recientes.
 */
export function ScanPeriodFilter({
  periods,
  currentPeriodId,
}: {
  periods: PeriodOption[];
  currentPeriodId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function navigate(nextPeriodId: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextPeriodId === "") params.delete("periodId");
    else params.set("periodId", nextPeriodId);
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `/teacher/scan?${qs}` : "/teacher/scan");
    });
  }

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
          onChange={(e) => navigate(e.target.value)}
        >
          <option value={ALL_PERIODS}>Todas</option>
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
