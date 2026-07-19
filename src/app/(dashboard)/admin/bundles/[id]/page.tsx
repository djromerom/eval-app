import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeGetBundle } from "@/modules/bundles/infrastructure/container";
import { makeListCourses } from "@/modules/academic/infrastructure/container";
import { makeListEvaluations } from "@/modules/evaluations/infrastructure/container";
import { computeCoverTable, formatDuration } from "@/modules/bundles/domain/cover-table";
import { BundleActionPanel } from "./action-buttons";
import { BundleEditForm } from "./edit-form";
import { ItemsManager } from "./items-manager";

export const metadata: Metadata = { title: "Detalle del compendio" };

const dateFmt = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" });

export default async function BundleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const { id } = await params;

  const result = await makeGetBundle().execute({ actor, bundleId: id });
  if (!result.ok) notFound();
  const bundle = result.value;
  const isDraft = bundle.status === "DRAFT";
  const coverTable = computeCoverTable(bundle.items);

  // Lista de evaluations aprobadas/publicadas disponibles para añadir.
  const [approved, published, coursesRes] = await Promise.all([
    makeListEvaluations().execute({ actor, status: "APPROVED" }),
    makeListEvaluations().execute({ actor, status: "PUBLISHED" }),
    makeListCourses().execute({ actor }),
  ]);
  const courses = coursesRes.ok ? coursesRes.value.map((c) => ({ id: c.id, name: c.name })) : [];
  const candidatesRaw = [
    ...(approved.ok ? approved.value : []),
    ...(published.ok ? published.value : []),
  ];
  const seen = new Set(bundle.items.map((i) => i.evaluationId));
  // Deduplicar, excluir las que ya están en el compendio y —si el compendio
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
            · {bundle.items.length} evaluación{bundle.items.length === 1 ? "" : "es"} ·{" "}
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
              courses={courses}
            />
          ) : (
            <div className="bg-card space-y-2 rounded-xl border p-6">
              <h2 className="font-semibold">Metadatos</h2>
              <p className="text-muted-foreground text-sm">
                <strong>{bundle.name}</strong> — cuadernillo{" "}
                <strong>{bundle.bookletNumber ?? "—"}</strong> — curso{" "}
                <strong>{bundle.courseName ?? "sin curso específico"}</strong>
              </p>
              <p className="text-muted-foreground text-xs">
                El compendio está sellado (READY). Desmárcate para editarlo.
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
              href={`/admin/bundles/${bundle.id}/designer`}
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "w-full")}
            >
              Diseñar portada →
            </Link>
          </div>
          <BundleActionPanel bundleId={bundle.id} isDraft={isDraft} />
        </aside>
      </div>
    </>
  );
}
