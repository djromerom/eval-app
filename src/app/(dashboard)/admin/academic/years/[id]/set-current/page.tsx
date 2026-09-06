import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeListAcademicYears } from "@/modules/academic/infrastructure/container";
import { SetCurrentAcademicYearForm } from "./set-current-form";

export const metadata: Metadata = { title: "Marcar año académico como actual" };

const dateFmt = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" });

/**
 * Página independiente para confirmar el cambio de año académico "actual".
 * El entry point es el botón "Marcar como actual" en `year-card.tsx`
 * (commit 5). UX: ruta dedicada (no drawer) porque es una operación
 * destructiva a nivel institución.
 */
export default async function SetCurrentAcademicYearPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireAuthenticatedUser("ECU_MASTER");

  const yearsRes = await makeListAcademicYears().execute({ actor });
  if (!yearsRes.ok) notFound();

  const year = yearsRes.value.find((y) => y.id === id);
  if (!year) notFound();

  return (
    <>
      <PageHeader
        title="Marcar como año académico actual"
        description={`Año ${year.year} · ${dateFmt.format(year.startDate)} → ${dateFmt.format(year.endDate)}`}
      />

      {/* Backdrop con link al overview (UX de drawer). */}
      <Link
        href="/admin/academic"
        aria-label="Cerrar y volver al inicio"
        className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm"
      />

      <aside
        aria-label={`Marcar ${year.year} como actual`}
        className="bg-background fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col border-l shadow-xl"
      >
        <header className="bg-muted/30 flex items-center justify-between gap-2 border-b p-5">
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              Año académico {year.year}
            </p>
            <h1 className="font-display text-xl font-bold">
              {year.isCurrent ? "Ya es el año actual" : "Marcar como actual"}
            </h1>
          </div>
          <Link
            href="/admin/academic"
            aria-label="Cerrar"
            className="hover:bg-muted inline-flex h-9 w-9 items-center justify-center rounded-md border"
          >
            <span aria-hidden>✕</span>
          </Link>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          <SetCurrentAcademicYearForm academicYearId={year.id} alreadyCurrent={year.isCurrent} />
        </div>
      </aside>
    </>
  );
}
