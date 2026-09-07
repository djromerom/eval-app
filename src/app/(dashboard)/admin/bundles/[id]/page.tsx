import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeGetBundle } from "@/modules/bundles/infrastructure/container";
import { makeListCourses, makeListPeriods } from "@/modules/academic/infrastructure/container";
import { makeListEvaluations } from "@/modules/evaluations/infrastructure/container";
import { makeListBookletTypesByInstitution } from "@/modules/booklet-types/infrastructure/container";
import { computeCoverTable, formatDuration } from "@/modules/bundles/domain/cover-table";
import { BundleActionPanel } from "./action-buttons";
import { BundleEditForm } from "./edit-form";
import { ItemsManager } from "./items-manager";

export const metadata: Metadata = { title: "Detalle del cuadernillo" };

const dateFmt = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" });

/** Convierte `Bundle.evaluationDate: Date | null` al formato `yyyy-mm-dd`
 *  que requiere `<input type="date">`. Devuelve "" si es null. */
function dateToInput(d: Date | null): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

export default async function BundleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAuthenticatedUser("ECU_MASTER", "ECU_LIDER");
  const { id } = await params;

  const result = await makeGetBundle().execute({ actor, bundleId: id });
  if (!result.ok) notFound();
  const bundle = result.value;
  const isDraft = bundle.status === "DRAFT";
  const coverTable = computeCoverTable(bundle.items);

  // Lista de evaluations aprobadas/publicadas disponibles para añadir +
  // cursos + periodos + bookletTypes para los selects del edit form.
  const [approved, published, coursesRes, periodsRes, bookletTypesRes] = await Promise.all([
    makeListEvaluations().execute({ actor, status: "APPROVED" }),
    makeListEvaluations().execute({ actor, status: "PUBLISHED" }),
    makeListCourses().execute({ actor }),
    makeListPeriods().execute({ actor }),
    makeListBookletTypesByInstitution().execute({ actor }),
  ]);
  const courses = coursesRes.ok ? coursesRes.value.map((c) => ({ id: c.id, name: c.name })) : [];
  const periods = periodsRes.ok ? periodsRes.value.map((p) => ({ id: p.id, name: p.name })) : [];
  const bookletTypes = bookletTypesRes.ok
    ? bookletTypesRes.value.map((bt) => ({ id: bt.id, periodId: bt.periodId, name: bt.name }))
    : [];
  const candidatesRaw = [
    ...(approved.ok ? approved.value : []),
    ...(published.ok ? published.value : []),
  ];
  const seen = new Set(bundle.items.map((i) => i.evaluationId));
  // Deduplicar, excluir las que ya están en el cuadernillo y —si el cuadernillo
  // tiene curso— las de otros cursos: el use case las rechazaría igualmente.
  const candSeen = new Set<string>();
  const candidatesDedup = candidatesRaw.filter((e) => {
    if (seen.has(e.id)) return false;
    if (candSeen.has(e.id)) return false;
    if (bundle.courseId && e.courseId !== bundle.courseId) return false;
    candSeen.add(e.id);
    return true;
  });

  return (
    <>
      <PageHeader
        title={bundle.name}
        description={
          <>
            {bundle.periodName ? `${bundle.periodName} · ` : ""}
            {bundle.bookletTypeName ? `${bundle.bookletTypeName} · ` : ""}
            {bundle.courseName ? `${bundle.courseName} · ` : ""}
            N° de cuadernillo {bundle.bookletNumber ?? "—"} ·{" "}
            <span
              className={
                isDraft
                  ? "bg-muted text-muted-foreground inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                  : "bg-primary/10 text-primary inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
              }
            >
              {isDraft ? "Borrador" : "Listo"}
            </span>{" "}
            · {bundle.items.length} formulación{bundle.items.length === 1 ? "" : "es"} ·{" "}
            {coverTable.totalQuestions} preguntas ({formatDuration(coverTable.totalMinutes)})
            {" · creado "}
            {dateFmt.format(bundle.createdAt)}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Columna izquierda — edición */}
        <div className="space-y-6 lg:col-span-2">
          {isDraft ? (
            <BundleEditForm
              bundleId={bundle.id}
              initialName={bundle.name}
              initialBookletNumber={bundle.bookletNumber}
              initialCourseId={bundle.courseId}
              initialPeriodId={bundle.periodId}
              initialBookletTypeId={bundle.bookletTypeId}
              initialEvaluationDate={dateToInput(bundle.evaluationDate)}
              courses={courses}
              periods={periods}
              bookletTypes={bookletTypes}
            />
          ) : (
            <div className="bg-card space-y-2 rounded-xl border p-6">
              <h2 className="font-semibold">Metadatos</h2>
              <p className="text-muted-foreground text-sm">
                <strong>{bundle.name}</strong> — cuadernillo{" "}
                <strong>{bundle.bookletNumber ?? "—"}</strong> — Prueba{" "}
                <strong>{bundle.periodName ?? "sin Prueba"}</strong>
                {bundle.bookletTypeName ? ` — tipo ${bundle.bookletTypeName}` : ""} — grado{" "}
                <strong>{bundle.courseName ?? "sin grado específico"}</strong>
              </p>
              <p className="text-muted-foreground text-xs">
                El cuadernillo está sellado (READY). Desmárcate para editarlo.
              </p>
            </div>
          )}

          <ItemsManager
            bundleId={bundle.id}
            items={bundle.items.map((i) => ({
              id: i.id,
              order: i.order,
              evaluationId: i.evaluationId,
              evaluationTitle: i.evaluationTitle,
              evaluationStatus: i.evaluationStatus,
              totalQuestions: i.totalQuestions,
              subjectName: i.subjectName,
              parentSubjectName: i.parentSubjectName,
            }))}
            candidates={candidatesDedup.map((e) => ({
              id: e.id,
              title: e.title,
              subjectName: e.subjectName,
              courseName: e.courseName,
              totalQuestions: e.totalQuestions,
            }))}
            isDraft={isDraft}
          />
        </div>

        {/* Columna derecha — acciones */}
        <aside className="space-y-4">
          <div className="bg-card space-y-2 rounded-xl border p-6">
            <h2 className="font-semibold">Diseño</h2>
            <p className="text-muted-foreground text-xs">
              Personaliza la portada del cuadernillo: subtítulo, pie de página, color acento,
              tipografía y bloque intro.
            </p>
            <Link
              href={`/admin/bundles/${bundle.id}/cover-designer`}
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "w-full")}
            >
              Diseñar portada →
            </Link>
          </div>
          <div className="bg-card space-y-2 rounded-xl border p-6">
            <h2 className="font-semibold">Cover Studio</h2>
            <p className="text-muted-foreground text-xs">
              Aplica un tema visual, ajusta el contenido de portada y prende o apaga bloques sin
              tocar el HTML.
            </p>
            <Link
              href={`/admin/bundles/${bundle.id}/cover-studio`}
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "w-full")}
            >
              Diseñar estilos →
            </Link>
          </div>
          <div className="bg-accent/30 border-accent/40 space-y-2 rounded-xl border-2 border-dashed p-6">
            <h2 className="font-semibold">HTML Live</h2>
            <p className="text-muted-foreground text-xs">
              Editor HTML directo con toolbar (negrita, encabezados, pegar, muestra, exportar). Para
              portadas con texto libre que no encajan en un preset.
            </p>
            <Link
              href={`/admin/bundles/${bundle.id}/cover-html`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full")}
            >
              Editar HTML live →
            </Link>
          </div>
          <BundleActionPanel bundleId={bundle.id} isDraft={isDraft} />
        </aside>
      </div>
    </>
  );
}
