import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/evaluations/status-badge";
import { makeListEvaluations } from "@/modules/evaluations/infrastructure/container";
import {
  makeListCourseSubjects,
  makeListPeriods,
} from "@/modules/academic/infrastructure/container";
import { makeListBookletTypesByInstitution } from "@/modules/booklet-types/infrastructure/container";
import { CreateEvaluationForm } from "./create-evaluation-form";
import { createEvaluationAction } from "./actions";

export const metadata: Metadata = { title: "Formulaciones" };

const df = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" });

export default async function EvaluationsPage() {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");
  const [listRes, csRes, periodsRes, bookletTypesRes] = await Promise.all([
    makeListEvaluations().execute({ actor }),
    makeListCourseSubjects().execute({ actor }),
    makeListPeriods().execute({ actor }),
    // Cargamos TODO el catálogo de la institución (decenas de filas) y
    // el cliente lo filtra por periodId. Tabla chica — no justifica un
    // endpoint específico.
    makeListBookletTypesByInstitution().execute({ actor }),
  ]);
  const evaluations = listRes.ok ? listRes.value : [];
  const courseSubjects = csRes.ok ? csRes.value : [];
  const periods = periodsRes.ok ? periodsRes.value : [];
  const bookletTypes = bookletTypesRes.ok ? bookletTypesRes.value : [];

  const csOptions = courseSubjects.map((cs) => ({
    value: cs.id,
    label: `${cs.subjectName} - ${cs.courseName}`,
  }));
  const periodOptions = periods.map((p) => ({ value: p.id, label: p.name }));

  return (
    <>
      <PageHeader
        title="Mis formulaciones"
        description="Formule, gestione y consulte sus ítems, siguiendo la estructura de los mismos."
      />

      <section className="bg-card space-y-4 rounded-xl border p-6">
        <h2 className="font-semibold">Formular ítems</h2>

        <CreateEvaluationForm
          action={createEvaluationAction}
          submitLabel="Formular"
          disabledReason={
            courseSubjects.length === 0
              ? "Un administrador debe enlazar asignaturas a cursos primero."
              : undefined
          }
          fields={[
            {
              name: "courseSubjectId",
              label: "Asignatura",
              type: "select",
              required: true,
              options: csOptions,
            },
            {
              name: "periodId",
              label: "Prueba",
              type: "select",
              options: periodOptions,
              required: true,
            },
          ]}
          bookletTypes={bookletTypes.map((bt) => ({
            id: bt.id,
            name: bt.name,
            periodId: bt.periodId,
          }))}
        />
      </section>

      <div className="mt-8 overflow-x-auto rounded-xl border-2 border-black dark:border-white">
        <table className="w-full text-sm">
          <thead className="text-foreground border-b-2 border-slate-300 bg-slate-200 text-left font-bold dark:border-slate-600 dark:bg-slate-700 dark:text-white">
            <tr>
              <th className="px-4 py-3 font-medium">Asignatura</th>
              <th className="px-4 py-3 font-medium">Prueba</th>
              <th className="px-4 py-3 font-medium">Estado</th>

              <th className="px-4 py-3 font-medium">Ítems.</th>
              <th className="px-4 py-3 font-medium">Actualizada</th>
            </tr>
          </thead>
          <tbody>
            {evaluations.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-muted-foreground px-4 py-8 text-center">
                  Aún no hay formulaciones.
                </td>
              </tr>
            ) : (
              evaluations.map((e) => (
                <tr
                  key={e.id}
                  className="hover:bg-muted/30 even:bg-muted/30 border-b last:border-0 odd:bg-white"
                >
                  <td className="px-4 py-3 font-medium">
                    <Link
                      href={`/teacher/evaluations/${e.id}/unified?from=list`}
                      className="hover:underline"
                    >
                      {e.title}
                    </Link>
                  </td>

                  <td className="text-muted-foreground px-4 py-3">{e.periodName}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={e.status} />
                  </td>

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
