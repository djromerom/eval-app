import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireAuthenticatedUser } from "@/lib/session";
import {
  makeGetPeriod,
  makeListAcademicYears,
  makeListPeriods,
} from "@/modules/academic/infrastructure/container";
import { PeriodEditForm } from "./period-edit-form";

export const metadata: Metadata = { title: "Editar prueba" };

const dateFmt = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" });

/**
 * Drawer de edición de un periodo académico (Fase 11).
 *
 * Patrón: ruta independiente `/admin/academic/periods/[id]/edit`. La página
 * renderiza el overview de academic con un panel lateral a la derecha y un
 * backdrop que difumina el fondo. Cancelar/volver navega de vuelta a
 * `/admin/academic` (back-button friendly, URL compartible).
 *
 * La página se monta encima del overview via CSS `fixed inset-0` para que
 * coincida con el mock de Pencil sin necesidad de duplicar el listado.
 */
export default async function EditPeriodPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireAuthenticatedUser("ECU_MASTER");

  const [periodRes, yearsRes, allPeriodsRes] = await Promise.all([
    makeGetPeriod().execute({ actor, periodId: id }),
    makeListAcademicYears().execute({ actor }),
    makeListPeriods().execute({ actor }),
  ]);

  if (!periodRes.ok) notFound();
  const period = periodRes.value;
  const years = yearsRes.ok ? yearsRes.value : [];
  const year = years.find((y) => y.id === period.academicYearId);
  const yearLabel = year ? String(year.year) : "—";

  // Para detectar conflictos de nombre en el form (UX): nombre del periodo
  // actual + nombres de los demás periodos del mismo año.
  const siblingNames = allPeriodsRes.ok
    ? allPeriodsRes.value
        .filter((p) => p.academicYearId === period.academicYearId && p.id !== period.id)
        .map((p) => p.name)
    : [];

  return (
    <>
      <PageHeader title="Estructura académica" description="Editando una prueba." />

      {/* Backdrop con link al overview (UX de drawer). */}
      <Link
        href="/admin/academic"
        aria-label="Cerrar drawer y volver al inicio"
        className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm"
      />

      {/* Drawer anclado a la derecha. */}
      <aside
        aria-label="Editar prueba"
        className="bg-background fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col border-l shadow-xl"
      >
        <header className="bg-muted/30 flex items-center justify-between gap-2 border-b p-5">
          <div className="space-y-1">
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
              <span className="bg-primary/10 text-primary inline-flex h-5 w-5 items-center justify-center rounded">
                {yearLabel}
              </span>
              Prueba · Año {yearLabel}
            </p>
            <h1 className="font-display text-xl font-bold">Editar prueba</h1>
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
          <PeriodEditForm
            period={{
              id: period.id,
              name: period.name,
              order: period.order,
              startDate: dateFmt.format(period.startDate),
              endDate: dateFmt.format(period.endDate),
              academicYearId: period.academicYearId,
              academicYearLabel: yearLabel,
            }}
            siblingNames={siblingNames}
          />
        </div>
      </aside>
    </>
  );
}
