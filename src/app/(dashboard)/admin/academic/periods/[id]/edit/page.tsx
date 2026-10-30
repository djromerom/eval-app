import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireAuthenticatedUser } from "@/lib/session";
import {
  makeGetPeriod,
  makeListAcademicYears,
  makeListCourseSubjects,
  makeListCourses,
  makeListPeriods,
  makeListSubjects,
} from "@/modules/academic/infrastructure/container";
import { makeListBookletTypesByPeriod } from "@/modules/booklet-types/infrastructure/container";
import { makeListBookletTypesByInstitution } from "@/modules/booklet-types/infrastructure/container";
import { buildBookletTypeVocabulary } from "@/modules/booklet-types/domain/booklet-type";
import {
  makeListEvaluationRulesByInstitution,
  makeListEvaluationRulesByPeriod,
} from "@/modules/evaluation-rules/infrastructure/container";
import { makeListOptionRulesByPeriod } from "@/modules/option-rules/infrastructure/container";
import { BookletTypesManager } from "./booklet-types-manager";
import { EvaluationRulesManager, type CloneSourcePeriod } from "./evaluation-rules-manager";
import { OptionRulesManager } from "./option-rules-manager";
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
 *
 * Desde ago 2026 el drawer también aloja el `BookletTypesManager` (gestión
 * del catálogo de tipos de cuadernillo por Prueba). El ancho se amplía a
 * 720px para que el form de periodos y la lista de tipos respiren, y
 * desde este sprint aloja también el `EvaluationRulesManager` (gestión de
 * reglas de conteo exacto por tupla).
 */
export default async function EditPeriodPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireAuthenticatedUser("ECU_MASTER");

  // Resolución en 2 fases: primero el periodo (necesario para conocer el
  // academicYear y filtrar cursos); luego el resto en paralelo.
  const periodRes = await makeGetPeriod().execute({ actor, periodId: id });
  if (!periodRes.ok) notFound();
  const period = periodRes.value;

  const [
    yearsRes,
    allPeriodsRes,
    bookletTypesRes,
    institutionBookletTypesRes,
    rulesRes,
    allRulesRes,
    optionRulesRes,
    coursesRes,
    subjectsRes,
    courseSubjectsRes,
  ] = await Promise.all([
    makeListAcademicYears().execute({ actor }),
    makeListPeriods().execute({ actor }),
    makeListBookletTypesByPeriod().execute({ actor, periodId: id }),
    makeListBookletTypesByInstitution().execute({ actor }),
    makeListEvaluationRulesByPeriod().execute({ actor, periodId: id }),
    makeListEvaluationRulesByInstitution().execute({ actor }),
    makeListOptionRulesByPeriod().execute({ actor, periodId: id }),
    makeListCourses().execute({ actor, academicYearId: period.academicYearId }),
    makeListSubjects().execute({ actor }),
    makeListCourseSubjects().execute({ actor }),
  ]);

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

  const bookletTypes = bookletTypesRes.ok
    ? bookletTypesRes.value.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
      }))
    : [];
  // Vocabulario institucional de nombres de tipo: el admin ELIGE uno de
  // estos en lugar de escribirlo a mano, así el catálogo no se fragmenta
  // por la ortografía ("Estandar" vs "Estándar").
  const availableNames = institutionBookletTypesRes.ok
    ? buildBookletTypeVocabulary(institutionBookletTypesRes.value).map((e) => e.name)
    : [];
  // Versión sin `description` para EvaluationRulesManager (solo necesita
  // id + name para el label de cada regla).
  const bookletTypesCatalog = bookletTypes.map((t) => ({ id: t.id, name: t.name }));

  const courses = coursesRes.ok ? coursesRes.value.map((c) => ({ id: c.id, name: c.name })) : [];
  const subjects = subjectsRes.ok ? subjectsRes.value.map((s) => ({ id: s.id, name: s.name })) : [];

  // Mapa courseId → subjectIds habilitado para ese grado. Permite al
  // `EvaluationRulesManager` filtrar el dropdown de asignaturas cuando el
  // admin selecciona un grado, así no se le muestran asignaturas que el
  // grado no tiene habilitadas (ej. 11° no suele tener Tecnología).
  // Si por alguna razón el mapa queda vacío para un curso, el cliente hace
  // fallback al listado completo (defensa en profundidad).
  const subjectsByCourse: Record<string, string[]> = {};
  if (courseSubjectsRes.ok) {
    for (const cs of courseSubjectsRes.value) {
      (subjectsByCourse[cs.courseId] ??= []).push(cs.subjectId);
    }
  }

  const rules = rulesRes.ok
    ? rulesRes.value.map((r) => ({
        id: r.id,
        courseId: r.courseId,
        subjectId: r.subjectId,
        bookletTypeId: r.bookletTypeId,
        exactQuestions: r.exactQuestions,
      }))
    : [];

  // Reglas de opciones de respuesta por (Prueba × Grado × Asignatura).
  const optionRules = optionRulesRes.ok
    ? optionRulesRes.value.map((r) => ({
        id: r.id,
        courseId: r.courseId,
        subjectId: r.subjectId,
        minOptions: r.minOptions,
        maxOptions: r.maxOptions,
      }))
    : [];

  // Pruebas desde las que se pueden copiar reglas de conteo (la actual se
  // excluye). El conteo de reglas le sirve al admin para saber si vale la
  // pena elegirla como origen.
  const ruleCountByPeriod = new Map<string, number>();
  if (allRulesRes.ok) {
    for (const r of allRulesRes.value) {
      ruleCountByPeriod.set(r.periodId, (ruleCountByPeriod.get(r.periodId) ?? 0) + 1);
    }
  }
  const yearById = new Map(years.map((y) => [y.id, y.year]));
  const sourcePeriods: CloneSourcePeriod[] = allPeriodsRes.ok
    ? allPeriodsRes.value
        .filter((p) => p.id !== period.id)
        .map((p) => ({
          id: p.id,
          name: p.name,
          year: yearById.get(p.academicYearId) ?? 0,
          ruleCount: ruleCountByPeriod.get(p.id) ?? 0,
        }))
        .sort((a, b) => b.year - a.year || a.name.localeCompare(b.name, "es"))
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

      {/* Drawer anclado a la derecha. Ancho 720px desde ago 2026 para
          alojar también el EvaluationRulesManager (3 selects side-by-side). */}
      <aside
        aria-label="Editar prueba"
        className="bg-background fixed inset-y-0 right-0 z-50 flex w-full max-w-[720px] flex-col border-l shadow-xl"
      >
        <header className="bg-muted/30 flex items-center justify-between gap-2 border-b p-5">
          <div className="space-y-1">
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
              <span className="bg-primary/10 text-primary inline-flex h-5 w-5 items-center justify-center rounded">
                {yearLabel}
              </span>
              Prueba · Año {yearLabel}
              {period.isCurrent && (
                <span className="bg-primary/15 text-primary inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase">
                  Actual
                </span>
              )}
            </p>
            <h1 className="font-display text-xl font-bold">{period.name}</h1>
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
              isCurrent: period.isCurrent,
            }}
            siblingNames={siblingNames}
          />
          <BookletTypesManager
            periodId={period.id}
            initialTypes={bookletTypes}
            availableNames={availableNames}
          />
          <EvaluationRulesManager
            periodId={period.id}
            initialRules={rules}
            courses={courses}
            subjects={subjects}
            subjectsByCourse={subjectsByCourse}
            bookletTypes={bookletTypesCatalog}
            sourcePeriods={sourcePeriods}
          />
          <OptionRulesManager
            periodId={period.id}
            initialRules={optionRules}
            courses={courses}
            subjects={subjects}
            subjectsByCourse={subjectsByCourse}
          />
        </div>
      </aside>
    </>
  );
}
