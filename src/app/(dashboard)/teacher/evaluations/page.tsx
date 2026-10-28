import type { Metadata } from "next";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { makeListEvaluations } from "@/modules/evaluations/infrastructure/container";
import {
  makeListCourseSubjects,
  makeListCourses,
  makeListPeriods,
} from "@/modules/academic/infrastructure/container";
import { makeListBookletTypesByInstitution } from "@/modules/booklet-types/infrastructure/container";
import { makeListTeacherAssignments } from "@/modules/teachers/infrastructure/container";
import { CreateEvaluationForm } from "./create-evaluation-form";
import { createEvaluationAction } from "./actions";
import { EvaluationsTable } from "./evaluations-table";

export const metadata: Metadata = { title: "Formulaciones" };

export default async function EvaluationsPage() {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER");
  const [csRes, periodsRes, bookletTypesRes, coursesRes, assignmentsRes] = await Promise.all([
    makeListCourseSubjects().execute({ actor }),
    makeListPeriods().execute({ actor }),
    // Cargamos TODO el catálogo de la institución (decenas de filas) y
    // el cliente lo filtra por periodId. Tabla chica — no justifica un
    // endpoint específico.
    makeListBookletTypesByInstitution().execute({ actor }),
    // Necesitamos los cursos para mapear courseSubjectId → academicYearId
    // y así preseleccionar la Prueba actual del año académico del docente.
    makeListCourses().execute({ actor }),
    // Asignaciones del docente: de ahí sale qué tipos de cuadernillo
    // puede formular para cada asignatura-grado (oct 2026).
    makeListTeacherAssignments().execute({ actor }),
  ]);
  const courseSubjects = csRes.ok ? csRes.value : [];
  const periods = periodsRes.ok ? periodsRes.value : [];
  const bookletTypes = bookletTypesRes.ok ? bookletTypesRes.value : [];
  const courses = coursesRes.ok ? coursesRes.value : [];
  const assignments = assignmentsRes.ok ? assignmentsRes.value : [];

  // "Mis formulaciones" muestra SOLO las formulaciones de la PRUEBA ACTUAL
  // (la que el admin marcó con `isCurrent`). Se resuelve con la misma regla
  // que el select "Prueba" del formulario (`periods.find(p => p.isCurrent)`)
  // para que el listado y el formulario hablen siempre de la misma prueba.
  // Sin ninguna prueba actual marcada, no se filtra: el docente ve todas
  // (igual que antes de este filtro).
  const currentPeriod = periods.find((p) => p.isCurrent);
  const listRes = await makeListEvaluations().execute({ actor, periodId: currentPeriod?.id });
  const evaluations = listRes.ok ? listRes.value : [];

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

  // Mapa de duplicados (`courseSubjectId|periodId|bookletTypeId` → evaluación
  // existente) — se consume en el wrapper client para que el form de creación,
  // en vez de fallar con "Ya existe una formulación…", muestre un link
  // directo a la formulación que ya está en el sistema. La clave compuesta
  // usa el string vacío como sentinel de "sin periodo" / "sin tipo" para
  // mantener 1:1 con la regla del repo (`periodId === null` ⇒
  // formulaciones sin periodo, `bookletTypeId === null` ⇒ sin tipo).
  // ago 2026: la clave incluye bookletTypeId para que un docente con una
  // formulación "Estándar" pueda crear la "Con Ajuste" sin que el form lo
  // redirija a la "Estándar".
  const existingMap: Record<string, { id: string; title: string }> = {};
  for (const e of evaluations) {
    const key = `${e.courseSubjectId}|${e.periodId ?? ""}|${e.bookletTypeId ?? ""}`;
    // Si hay múltiples evaluaciones con la misma combinación (no debería
    // gracias al constraint del use case, pero defensivo), gana la más
    // reciente porque la query ya viene ordenada por updatedAt desc.
    if (!existingMap[key]) {
      existingMap[key] = { id: e.id, title: e.title };
    }
  }

  // Tipos de cuadernillo permitidos por asignatura-grado, según las
  // asignaciones del docente (oct 2026). Una asignación con tipo `null`
  // significa "cualquier cuadernillo" → `anyType` y no se filtra nada.
  const allowedTypesByCs: Record<string, { anyType: boolean; types: string[] }> = {};
  for (const a of assignments) {
    const entry = allowedTypesByCs[a.courseSubjectId] ?? { anyType: false, types: [] };
    if (a.bookletTypeId === null) {
      entry.anyType = true;
    } else if (!entry.types.includes(a.bookletTypeId)) {
      entry.types.push(a.bookletTypeId);
    }
    allowedTypesByCs[a.courseSubjectId] = entry;
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
              ? "Un administrador debe enlazar asignaturas a grados primero."
              : undefined
          }
          fields={[
            {
              name: "periodId",
              label: "Prueba",
              type: "select",
              options: periodOptions,
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
          /** Tipos de cuadernillo que el docente puede formular para cada
           *  asignatura-grado, según sus asignaciones (oct 2026). `anyType`
           *  = la asignación aplica a cualquier cuadernillo → no se filtra. */
          allowedTypesByCs={allowedTypesByCs}
        />
      </section>

      <EvaluationsTable data={evaluations} />
    </>
  );
}
