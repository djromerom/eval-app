import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/evaluations/status-badge";
import { makeListEvaluations } from "@/modules/evaluations/infrastructure/container";
import {
  makeListCourseSubjects,
  makeListCourses,
  makeListPeriods,
} from "@/modules/academic/infrastructure/container";
import { makeListBookletTypesByInstitution } from "@/modules/booklet-types/infrastructure/container";
import { CreateEvaluationForm } from "./create-evaluation-form";
import { createEvaluationAction } from "./actions";

export const metadata: Metadata = { title: "Formulaciones" };

const df = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" });

export default async function EvaluationsPage() {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");
  const [listRes, csRes, periodsRes, bookletTypesRes, coursesRes] = await Promise.all([
    makeListEvaluations().execute({ actor }),
    makeListCourseSubjects().execute({ actor }),
    makeListPeriods().execute({ actor }),
    // Cargamos TODO el catálogo de la institución (decenas de filas) y
    // el cliente lo filtra por periodId. Tabla chica — no justifica un
    // endpoint específico.
    makeListBookletTypesByInstitution().execute({ actor }),
    // Necesitamos los cursos para mapear courseSubjectId → academicYearId
    // y así preseleccionar la Prueba actual del año académico del docente.
    makeListCourses().execute({ actor }),
  ]);
  const evaluations = listRes.ok ? listRes.value : [];
  const courseSubjects = csRes.ok ? csRes.value : [];
  const periods = periodsRes.ok ? periodsRes.value : [];
  const bookletTypes = bookletTypesRes.ok ? bookletTypesRes.value : [];
  const courses = coursesRes.ok ? coursesRes.value : [];

  // Mapa courseId → academicYearId (necesario para resolver la Prueba
  // "actual" del año académico del courseSubject que el docente eligió).
  const courseYearMap = new Map(courses.map((c) => [c.id, c.academicYearId]));
  // Mapa directo courseSubjectId → academicYearId (lo consume el wrapper).
  const csYearMap: Record<string, string> = {};
  for (const cs of courseSubjects) {
    const ay = courseYearMap.get(cs.courseId);
    if (ay) csYearMap[cs.id] = ay;
  }

  const csOptions = courseSubjects.map((cs) => ({
    value: cs.id,
    label: `${cs.subjectName} - ${cs.courseName}`,
  }));
  const periodOptions = periods.map((p) => ({ value: p.id, label: p.name }));

  // Mapa de duplicados (courseSubjectId|periodId → evaluación existente) —
  // se consume en el wrapper client para que el form de creación, en vez de
  // fallar con "Ya existe una formulación…", muestre un link directo a la
  // formulación que ya está en el sistema. La clave compuesta usa el string
  // vacío como sentinel de "sin periodo" para mantener 1:1 con la regla del
  // repo (`periodId === null` ⇒ formulaciones sin periodo).
  const existingMap: Record<string, { id: string; title: string }> = {};
  for (const e of evaluations) {
    const key = `${e.courseSubjectId}|${e.periodId ?? ""}`;
    // Si hay múltiples evaluaciones con la misma combinación (no debería
    // gracias al constraint del use case, pero defensivo), gana la más
    // reciente porque la query ya viene ordenada por updatedAt desc.
    if (!existingMap[key]) {
      existingMap[key] = { id: e.id, title: e.title };
    }
  }

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
              name: "periodId",
              label: "Prueba",
              type: "select",
              options: periodOptions,
              required: true,
            },
            {
              name: "courseSubjectId",
              label: "Asignatura",
              type: "select",
              required: true,
              options: csOptions,
            },
          ]}
          bookletTypes={bookletTypes.map((bt) => ({
            id: bt.id,
            name: bt.name,
            periodId: bt.periodId,
          }))}
          /** Mapeo courseSubjectId → academicYearId para preseleccionar y
           *  bloquear el select de Prueba cuando hay una Prueba marcada
           *  como "actual" en el año académico del curso del docente (ago
           *  2026). */
          csYearMap={csYearMap}
          /** Periodos con `isCurrent` y `academicYearId` para preseleccionar y
           *  bloquear el select cuando hay Prueba actual marcada. */
          periods={periods.map((p) => ({
            id: p.id,
            name: p.name,
            academicYearId: p.academicYearId,
            isCurrent: p.isCurrent,
          }))}
          /** Mapa (courseSubjectId|periodId) → { id, title } para detectar
           *  duplicados client-side y redirigir al docente a la formulación
           *  existente en lugar de fallar con un error 409 (ago 2026). */
          existingMap={existingMap}
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
