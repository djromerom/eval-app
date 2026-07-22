import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { ScanStatusBadge } from "@/components/evaluations/scan-status-badge";
import { makeListEvaluations } from "@/modules/evaluations/infrastructure/container";
import { makeListBundles } from "@/modules/bundles/infrastructure/container";
import { UploadZone, type ScanTarget } from "./upload-zone";
import { getBatchesAction } from "./actions";

export const metadata: Metadata = { title: "Escanear hojas" };

const df = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" });

export default async function ScanPage() {
  const actor = await requireAuthenticatedUser("TEACHER");
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
        description="Sube las hojas escaneadas de una evaluación o un compendio para calificarlas automáticamente."
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
          <div className="space-y-4">
            {batches.map((batch) => (
              <div key={batch.id} className="bg-card rounded-xl border p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="bg-muted text-muted-foreground mr-2 rounded px-2 py-0.5 text-xs font-medium">
                      {batch.kind === "bundle" ? "Compendio" : "Evaluación"}
                    </span>
                    <span className="font-medium">{batch.title ?? "(sin nombre)"}</span>
                    <span className="text-muted-foreground ml-2 text-sm">
                      {df.format(new Date(batch.createdAt))}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-muted-foreground">
                      {batch.processedSheets}/{batch.totalSheets} hojas
                    </span>
                    <ScanStatusBadge status={batch.status} size="lg" />
                  </div>
                </div>

                {batch.sheets.length > 0 && (
                  <div className="mt-3 overflow-x-auto rounded-lg border text-sm">
                    <table className="w-full">
                      <thead className="bg-muted/40 text-muted-foreground border-b text-left">
                        <tr>
                          <th className="px-3 py-2 font-medium">Hoja</th>
                          <th className="px-3 py-2 font-medium">Estudiante</th>
                          <th className="px-3 py-2 font-medium">Código</th>
                          <th className="px-3 py-2 font-medium">Estado</th>
                          <th className="px-3 py-2 font-medium">Puntaje</th>
                          <th className="px-3 py-2 font-medium">Notas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batch.sheets.map((s) => (
                          <tr key={s.id} className="border-b last:border-0">
                            <td className="px-3 py-2 font-mono text-xs">
                              <Link
                                href={`/teacher/scan/${batch.id}/${s.id}`}
                                className="hover:text-foreground text-primary underline"
                              >
                                {s.id.slice(0, 8)}
                              </Link>
                            </td>
                            <td className="px-3 py-2">{s.studentName ?? "—"}</td>
                            <td className="px-3 py-2">{s.studentCode ?? "—"}</td>
                            <td className="px-3 py-2">
                              <ScanStatusBadge status={s.status} />
                            </td>
                            <td className="px-3 py-2">
                              {s.score !== null ? `${s.totalCorrect}/${s.totalQuestions}` : "—"}
                            </td>
                            <td className="text-muted-foreground max-w-40 truncate px-3 py-2">
                              {s.notes ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
