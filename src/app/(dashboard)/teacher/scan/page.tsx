import type { Metadata } from "next";
import { Suspense } from "react";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { makeListEvaluations } from "@/modules/evaluations/infrastructure/container";
import { makeListBundles } from "@/modules/bundles/infrastructure/container";
import { makeGetCurrentPeriod, makeListPeriods } from "@/modules/academic/infrastructure/container";
import { resolvePeriodFilter } from "@/modules/academic/domain/period-filter";
import { UploadZone, type ScanTarget } from "./upload-zone";
import { BatchCardsList } from "./batch-cards-list";
import { ScanPeriodFilter } from "./_components/scan-period-filter";
import { getBatchesAction } from "./actions";

export const metadata: Metadata = { title: "Escanear hojas" };

type SearchParams = Promise<{ periodId?: string }>;

export default async function ScanPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER");
  const params = await searchParams;

  // El escaneo se acota a la PRUEBA ACTUAL (la marcada con `isCurrent`),
  // igual que Cuadernillos, Revisión y Mis formulaciones: el docente escanea
  // las hojas de la prueba en curso, no las de años anteriores. El filtro
  // vive en la URL y "Todas" se pide explícitamente (centinela `all`).
  const currentPeriodRes = await makeGetCurrentPeriod().execute({ actor });
  const currentPeriod = currentPeriodRes.ok ? currentPeriodRes.value : null;
  const periodFilter = resolvePeriodFilter(params.periodId ?? "", currentPeriod?.id ?? null);
  const effectivePeriodId = periodFilter.periodId ?? "";

  const [listRes, bundlesRes, periodsRes] = await Promise.all([
    makeListEvaluations().execute({ actor, periodId: effectivePeriodId || undefined }),
    makeListBundles().execute({
      actor,
      filters: effectivePeriodId ? { periodId: effectivePeriodId } : {},
    }),
    makeListPeriods().execute({ actor }),
  ]);

  const targets: ScanTarget[] = [
    ...(listRes.ok
      ? listRes.value.map((e) => ({ kind: "evaluation" as const, id: e.id, title: e.title }))
      : []),
    ...(bundlesRes.ok
      ? bundlesRes.value.map((b) => ({ kind: "bundle" as const, id: b.id, title: b.name }))
      : []),
  ];

  const periods = periodsRes.ok ? periodsRes.value.map((p) => ({ id: p.id, name: p.name })) : [];

  const batches = await getBatchesAction(effectivePeriodId || null);

  return (
    <>
      <PageHeader
        title="Escanear hojas de respuestas"
        description="Sube las hojas escaneadas de una formulación o un cuadernillo para calificarlas automáticamente."
      />

      {/* `useSearchParams` requiere Suspense en producción */}
      <Suspense fallback={null}>
        <ScanPeriodFilter periods={periods} currentPeriodId={effectivePeriodId} />
      </Suspense>

      <section className="from-brand-blue-tint to-brand-mint-tint space-y-4 rounded-2xl bg-linear-to-br p-6">
        <div className="flex items-center gap-2">
          <span className="bg-primary h-2 w-2 rounded-full" />
          <h2 className="font-display text-primary font-semibold">Nuevo lote</h2>
        </div>
        <UploadZone targets={targets} />
      </section>

      <section className="mt-8 space-y-4">
        <h2 className="font-display text-lg font-semibold">Lotes recientes</h2>
        {batches.length === 0 ? (
          <p className="text-muted-foreground text-sm">No hay lotes de escaneo todavía.</p>
        ) : (
          <BatchCardsList
            batches={batches.map((b) => ({
              id: b.id,
              kind: b.kind,
              status: b.status,
              totalSheets: b.totalSheets,
              processedSheets: b.processedSheets,
              createdAt: b.createdAt,
              title: b.title,
              sinClasificar: b.sinClasificar,
              sheets: b.sheets,
            }))}
          />
        )}
      </section>
    </>
  );
}
