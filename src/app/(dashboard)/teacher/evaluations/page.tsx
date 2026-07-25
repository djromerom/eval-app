import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { EntityForm } from "@/components/admin/entity-form";
import { StatusBadge } from "@/components/evaluations/status-badge";
import { makeListEvaluations } from "@/modules/evaluations/infrastructure/container";
import {
  makeListCourseSubjects,
  makeListPeriods,
} from "@/modules/academic/infrastructure/container";
import { createEvaluationAction } from "./actions";

export const metadata: Metadata = { title: "Formulaciones" };

const df = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" });

export default async function EvaluationsPage() {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");
  const [listRes, csRes, periodsRes] = await Promise.all([
    makeListEvaluations().execute({ actor }),
    makeListCourseSubjects().execute({ actor }),
    makeListPeriods().execute({ actor }),
  ]);
  const evaluations = listRes.ok ? listRes.value : [];
  const courseSubjects = csRes.ok ? csRes.value : [];
  const periods = periodsRes.ok ? periodsRes.value : [];

  const csOptions = courseSubjects.map((cs) => ({
    value: cs.id,
    label: `${cs.courseName} · ${cs.subjectName}`,
  }));
  const periodOptions = periods.map((p) => ({ value: p.id, label: p.name }));

  return (
    <>
      <PageHeader
        title="Mis formulaciones"
        description="Crea formulaciones tipo ICFES, agrégales preguntas y envíalas a revisión."
      />

      <section className="bg-card space-y-4 rounded-xl border p-6">
        <h2 className="font-semibold">Nueva formulación</h2>
        <p className="text-muted-foreground -mt-2 text-sm">
          El título se genera automáticamente como{" "}
          <span className="text-foreground font-mono text-xs">Asignatura · Curso · Año</span>.
        </p>
        <EntityForm
          action={createEvaluationAction}
          submitLabel="Crear borrador"
          disabledReason={
            courseSubjects.length === 0
              ? "Un administrador debe enlazar asignaturas a cursos primero."
              : undefined
          }
          fields={[
            {
              name: "courseSubjectId",
              label: "Asignatura-curso",
              type: "select",
              required: true,
              options: csOptions,
            },
            { name: "periodId", label: "Periodo", type: "select", options: periodOptions },
          ]}
        />
      </section>

      <div className="mt-8 overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground border-b text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Título</th>
              <th className="px-4 py-3 font-medium">Asignatura-curso</th>
              <th className="px-4 py-3 font-medium">Periodo</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Ver.</th>
              <th className="px-4 py-3 font-medium">Preg.</th>
              <th className="px-4 py-3 font-medium">Actualizada</th>
            </tr>
          </thead>
          <tbody>
            {evaluations.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-muted-foreground px-4 py-8 text-center">
                  Aún no hay formulaciones.
                </td>
              </tr>
            ) : (
              evaluations.map((e) => (
                <tr key={e.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">
                    <Link
                      href={`/teacher/evaluations/${e.id}/contexts`}
                      className="hover:underline"
                    >
                      {e.title}
                    </Link>
                  </td>
                  <td className="text-muted-foreground px-4 py-3">
                    {e.courseName} · {e.subjectName}
                  </td>
                  <td className="text-muted-foreground px-4 py-3">
                    {e.periodName ?? <span className="text-muted-foreground/60">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={e.status} />
                  </td>
                  <td className="text-muted-foreground px-4 py-3">v{e.version}</td>
                  <td className="text-muted-foreground px-4 py-3">{e.totalQuestions}</td>
                  <td className="text-muted-foreground px-4 py-3">{df.format(e.updatedAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
