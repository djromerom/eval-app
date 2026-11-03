import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeListBundles } from "@/modules/bundles/infrastructure/container";
import { makeListPeriods, makeGetCurrentPeriod } from "@/modules/academic/infrastructure/container";
import { makeListBookletTypesByInstitution } from "@/modules/booklet-types/infrastructure/container";
import type { BundleStatus } from "@/modules/bundles/domain/bundle-status";
import { resolvePeriodFilter } from "@/modules/academic/domain/period-filter";
import { cn } from "@/lib/utils";
import { BundlesFilterRow } from "./_components/bundles-filter-row";

export const metadata: Metadata = { title: "Cuadernillos" };

const dateFmt = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" });

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Borrador",
  READY: "Listo",
};

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "DRAFT", label: "Borrador" },
  { value: "READY", label: "Listo" },
];

type SearchParams = Promise<{
  periodId?: string;
  bookletTypeId?: string;
  status?: string;
}>;

function isBundleStatus(value: string | undefined): value is BundleStatus {
  return value === "DRAFT" || value === "READY";
}

export default async function BundlesListPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAuthenticatedUser("ECU_MASTER", "ECU_LIDER");
  const params = await searchParams;

  const periodId = (params.periodId ?? "").trim();
  const bookletTypeId = (params.bookletTypeId ?? "").trim();
  const status = (params.status ?? "").trim();

  // El listado arranca en la PRUEBA ACTUAL (la marcada con `isCurrent`),
  // igual que el módulo de revisión y el Listado de Formulaciones: el
  // admin trabaja sobre la prueba en curso, no sobre las de años
  // anteriores. La regla (y el centinela "ver todas") vive en el dominio:
  // `resolvePeriodFilter`.
  const currentPeriodRes = await makeGetCurrentPeriod().execute({ actor });
  const currentPeriod = currentPeriodRes.ok ? currentPeriodRes.value : null;
  const periodFilter = resolvePeriodFilter(periodId, currentPeriod?.id ?? null);
  const effectivePeriodId = periodFilter.periodId ?? "";

  const filters = {
    ...(effectivePeriodId ? { periodId: effectivePeriodId } : {}),
    ...(bookletTypeId ? { bookletTypeId } : {}),
    ...(isBundleStatus(status) ? { status } : {}),
  };

  const [bundlesRes, allBundlesRes, periodsRes, bookletTypesRes] = await Promise.all([
    makeListBundles().execute({ actor, filters }),
    // Listado SIN filtros: solo lo usamos para distinguir "no hay
    // cuadernillos en la institución" de "no hay cuadernillos que
    // coinciden con el filtro" en el estado vacío de la tabla.
    makeListBundles().execute({ actor }),
    makeListPeriods().execute({ actor }),
    makeListBookletTypesByInstitution().execute({ actor }),
  ]);

  const bundles = bundlesRes.ok ? bundlesRes.value : [];
  const hasAnyBundle = allBundlesRes.ok && allBundlesRes.value.length > 0;
  const periods = periodsRes.ok ? periodsRes.value.map((p) => ({ id: p.id, name: p.name })) : [];
  const bookletTypes = bookletTypesRes.ok
    ? bookletTypesRes.value.map((bt) => ({ id: bt.id, periodId: bt.periodId, name: bt.name }))
    : [];

  return (
    <>
      <PageHeader
        title="Cuadernillos"
        description="Agrupa varias formulaciones aprobadas en un único cuadernillo para imprimir (cuadernillos multi-asignatura)."
      />

      <div className="mb-4 flex justify-end">
        <Link href="/admin/bundles/new" className={cn(buttonVariants())}>
          Nuevo cuadernillo
        </Link>
      </div>

      {/* `useSearchParams` requiere Suspense en producción */}
      <Suspense fallback={null}>
        <BundlesFilterRow
          periods={periods}
          bookletTypes={bookletTypes}
          statuses={STATUS_OPTIONS}
          currentPeriodId={effectivePeriodId}
          currentBookletTypeId={bookletTypeId}
          currentStatus={status}
        />
      </Suspense>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground border-b text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Nombre</th>
              <th className="px-4 py-3 font-medium">Prueba</th>
              <th className="px-4 py-3 font-medium">Tipo</th>
              <th className="px-4 py-3 font-medium">Grado</th>
              <th className="px-4 py-3 font-medium">N° cuadernillo</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Creado</th>
              <th className="px-4 py-3 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {bundles.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-muted-foreground px-4 py-8 text-center">
                  {hasAnyBundle
                    ? "Ninguna fila coincide con los filtros aplicados."
                    : "Aún no hay cuadernillos. Crea uno para empezar."}
                </td>
              </tr>
            ) : (
              bundles.map((b) => (
                <tr key={b.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/admin/bundles/${b.id}`} className="hover:underline">
                      {b.name}
                    </Link>
                  </td>
                  <td className="text-muted-foreground px-4 py-3">{b.periodName ?? "—"}</td>
                  <td className="text-muted-foreground px-4 py-3">{b.bookletTypeName ?? "—"}</td>
                  <td className="text-muted-foreground px-4 py-3">{b.courseName ?? "—"}</td>
                  <td className="text-muted-foreground px-4 py-3">{b.bookletNumber ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        b.status === "READY"
                          ? "bg-primary/10 text-primary inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                          : "bg-muted text-muted-foreground inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                      }
                    >
                      {STATUS_LABEL[b.status] ?? b.status}
                    </span>
                  </td>
                  <td className="text-muted-foreground px-4 py-3">{dateFmt.format(b.createdAt)}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/bundles/${b.id}`}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    >
                      Abrir
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
