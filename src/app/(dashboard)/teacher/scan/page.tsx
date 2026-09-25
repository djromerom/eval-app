import type { Metadata } from "next";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { makeListEvaluations } from "@/modules/evaluations/infrastructure/container";
import { makeListBundles } from "@/modules/bundles/infrastructure/container";
import { UploadZone, type ScanTarget } from "./upload-zone";
import { BatchCardsList } from "./batch-cards-list";
import { getBatchesAction } from "./actions";

export const metadata: Metadata = { title: "Escanear hojas" };

export default async function ScanPage() {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER");
  const [listRes, bundlesRes] = await Promise.all([
    makeListEvaluations().execute({ actor }),
    makeListBundles().execute({ actor }),
  ]);

  const targets: ScanTarget[] = [
    ...(listRes.ok
      ? listRes.value.map((e) => ({ kind: "evaluation" as const, id: e.id, title: e.title }))
      : []),
    ...(bundlesRes.ok
      ? bundlesRes.value.map((b) => ({ kind: "bundle" as const, id: b.id, title: b.name }))
      : []),
  ];

  const batches = await getBatchesAction();

  return (
    <>
      <PageHeader
        title="Escanear hojas de respuestas"
        description="Sube las hojas escaneadas de una formulación o un cuadernillo para calificarlas automáticamente."
      />

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
