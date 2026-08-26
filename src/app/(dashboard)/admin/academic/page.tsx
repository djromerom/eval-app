import type { Metadata } from "next";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import {
  makeListAcademicYears,
  makeListCourseSubjects,
  makeListCourses,
  makeListGroups,
  makeListPeriods,
  makeListSubjects,
} from "@/modules/academic/infrastructure/container";
import { EntityForm } from "./entity-form";
import {
  createAcademicYearAction,
  createCourseAction,
  createCourseSubjectAction,
  createGroupAction,
  createPeriodAction,
  createSubjectAction,
} from "./actions";
import { KpiStrip } from "./_components/kpi-strip";
import { FilterRow } from "./_components/filter-row";
import { YearCard } from "./_components/year-card";
import { SetupBanner } from "./_components/setup-banner";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Estructura académica" };

const df = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" });
// Header colapsado: mes corto + día → "ene 15 — nov 30"
const monthDayFmt = new Intl.DateTimeFormat("es-CO", { month: "short", day: "numeric" });

async function loadAll(actor: AuthenticatedUser) {
  const [years, periods, courses, subjects, groups, courseSubjects] = await Promise.all([
    makeListAcademicYears().execute({ actor }),
    makeListPeriods().execute({ actor }),
    makeListCourses().execute({ actor }),
    makeListSubjects().execute({ actor }),
    makeListGroups().execute({ actor }),
    makeListCourseSubjects().execute({ actor }),
  ]);
  return {
    years: years.ok ? years.value : [],
    periods: periods.ok ? periods.value : [],
    courses: courses.ok ? courses.value : [],
    subjects: subjects.ok ? subjects.value : [],
    groups: groups.ok ? groups.value : [],
    courseSubjects: courseSubjects.ok ? courseSubjects.value : [],
  };
}

export default async function AcademicPage() {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const { years, periods, courses, subjects, groups, courseSubjects } = await loadAll(actor);

  const yearOptions = years.map((y) => ({ value: y.id, label: String(y.year) }));
  const courseOptions = courses.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }));
  const subjectOptions = subjects.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }));
  const courseLabel = new Map(courses.map((c) => [c.id, c.name]));

  // ===== Derivaciones para el Pencil design =====
  const activePeriodsCount = periods.filter((p) => {
    const now = new Date();
    return p.startDate <= now && p.endDate >= now;
  }).length;

  // Agrupa periodos y cursos por año académico para renderizar una card por
  // año (todas expandidas por defecto).
  const periodsByYear = new Map<string, typeof periods>();
  for (const p of periods) {
    const arr = periodsByYear.get(p.academicYearId) ?? [];
    arr.push(p);
    periodsByYear.set(p.academicYearId, arr);
  }
  const coursesByYear = new Map<string, typeof courses>();
  for (const c of courses) {
    const arr = coursesByYear.get(c.academicYearId) ?? [];
    arr.push(c);
    coursesByYear.set(c.academicYearId, arr);
  }
  const groupsByCourse = new Map<string, number>();
  for (const g of groups) groupsByCourse.set(g.courseId, (groupsByCourse.get(g.courseId) ?? 0) + 1);
  const subjectsByCourse = new Map<string, number>();
  for (const cs of courseSubjects)
    subjectsByCourse.set(cs.courseId, (subjectsByCourse.get(cs.courseId) ?? 0) + 1);

  const sortedYears = [...years].sort((a, b) => Number(b.year) - Number(a.year));
  // Cada card es colapsable y guarda su propio estado, así que se puede tener
  // varios años abiertos a la vez (caso típico: comparar 2026 vs 2027
  // durante una migración). Por defecto solo el año `isCurrent` (o el más
  // reciente si ninguno está marcado) arranca expandido; el resto queda
  // cerrado para mantener el overview escaneable con muchos años.
  const defaultExpandedYearId = years.find((y) => y.isCurrent)?.id ?? sortedYears[0]?.id;
  const isEmpty = years.length === 0;

  // ===== Datos para el sub-form de "Agregar asignatura / grupo" por curso =====
  // Lista de grupos por curso para mostrar en la card del curso (en vez de
  // solo el count) + set de subjectIds ya enlazados para filtrar el select
  // de "Agregar asignatura" (no se debe poder enlazar la misma asignatura 2x).
  const groupsByCourseMap = new Map<string, typeof groups>();
  for (const g of groups) {
    const arr = groupsByCourseMap.get(g.courseId) ?? [];
    arr.push(g);
    groupsByCourseMap.set(g.courseId, arr);
  }
  const linkedSubjectsByCourse = new Map<string, Set<string>>();
  for (const cs of courseSubjects) {
    const set = linkedSubjectsByCourse.get(cs.courseId) ?? new Set();
    set.add(cs.subjectId);
    linkedSubjectsByCourse.set(cs.courseId, set);
  }

  return (
    <>
      <PageHeader
        title="Estructura académica"
        description="Años, pruebas, grados, asignaturas y grupos de tu institución (ADMIN)."
      />

      {/* ===== Pencil: Setup banner cuando no hay nada configurado ===== */}
      {isEmpty && <SetupBanner />}

      {/* ===== Pencil: KPI strip ===== */}
      <KpiStrip
        yearsCount={years.length}
        activePeriods={activePeriodsCount}
        coursesCount={courses.length}
        subjectsCount={subjects.length}
      />

      {/* ===== Pencil: Filter row ===== */}
      <div className="mt-6">
        <FilterRow
          yearsCount={years.length}
          periodsCount={periods.length}
          coursesCount={courses.length}
          subjectsCount={subjects.length}
        />
      </div>

      {/* ===== Pencil: Year · cards ===== */}
      <div className="mt-6 space-y-4">
        {sortedYears.map((year) => {
          const yearPeriods = periodsByYear.get(year.id) ?? [];
          const yearCourses = coursesByYear.get(year.id) ?? [];
          return (
            <YearCard
              key={year.id}
              year={year}
              defaultExpanded={year.id === defaultExpandedYearId}
              periodCount={yearPeriods.length}
              courseCount={yearCourses.length}
              formattedRange={`${df.format(year.startDate)} – ${df.format(year.endDate)}`}
              shortRange={`${monthDayFmt.format(year.startDate)} — ${monthDayFmt.format(year.endDate)}`}
              periods={yearPeriods.map((p) => ({
                id: p.id,
                name: p.name,
                order: p.order,
                formattedRange: `${df.format(p.startDate)} – ${df.format(p.endDate)}`,
                isCurrent: p.isCurrent,
              }))}
              courses={yearCourses.map((c) => {
                const linked = linkedSubjectsByCourse.get(c.id) ?? new Set();
                const linkedSubjectRows = (courseSubjects ?? [])
                  .filter((cs) => cs.courseId === c.id)
                  .map((cs) => ({ id: cs.id, name: cs.subjectName }));
                return {
                  id: c.id,
                  name: c.name,
                  code: c.code,
                  groups: (groupsByCourseMap.get(c.id) ?? []).map((g) => ({
                    id: g.id,
                    name: g.name,
                  })),
                  subjects: linkedSubjectRows,
                  availableSubjects: subjectOptions.filter((s) => !linked.has(s.value)),
                };
              })}
            />
          );
        })}
      </div>

      {/* ===== Secciones CRUD heredadas (siguen vivas y operativas) =====
          Las movemos a un colapsable al final para no romper el flujo de
          creación rápida que el docente usa hoy. Cada EntityForm sigue
          apuntando al action de su recurso. */}
      <details className="bg-card mt-8 rounded-xl border p-4 [&[open]>summary]:mb-4">
        <summary className="text-muted-foreground cursor-pointer text-sm font-semibold">
          Herramientas de alta rápida (avanzado)
        </summary>
        <p className="text-muted-foreground mb-4 text-xs">
          Formularios directos para crear cada entidad. Como alternativa, puedes usar las acciones
          &ldquo;Agregar prueba&rdquo; / &ldquo;Agregar grado&rdquo; dentro de cada año arriba.
        </p>

        <div className="space-y-6">
          <CrudSection title="Años académicos">
            <EntityForm
              action={createAcademicYearAction}
              submitLabel="Agregar año"
              fields={[
                { name: "year", label: "Año", type: "number", required: true, placeholder: "2026" },
                { name: "startDate", label: "Inicio", type: "date", required: true },
                { name: "endDate", label: "Fin", type: "date", required: true },
                { name: "isCurrent", label: "¿Actual?", type: "checkbox" },
              ]}
            />
            {years.length === 0 ? null : (
              <ul className="divide-y text-sm">
                {years.map((y) => (
                  <li key={y.id} className="flex items-center gap-3 py-2">
                    <span className="font-medium">{y.year}</span>
                    {y.isCurrent ? (
                      <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs">
                        Actual
                      </span>
                    ) : null}
                    <span className="text-muted-foreground">
                      {df.format(y.startDate)} – {df.format(y.endDate)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CrudSection>

          <CrudSection title="Pruebas">
            <EntityForm
              action={createPeriodAction}
              submitLabel="Agregar prueba"
              disabledReason={years.length === 0 ? "Crea primero un año académico." : undefined}
              fields={[
                {
                  name: "academicYearId",
                  label: "Año",
                  type: "select",
                  required: true,
                  options: yearOptions,
                },
                {
                  name: "name",
                  label: "Nombre",
                  type: "text",
                  required: true,
                  placeholder: "I Prueba",
                },
                { name: "order", label: "Orden", type: "number", required: true, placeholder: "1" },
                { name: "startDate", label: "Inicio", type: "date", required: true },
                { name: "endDate", label: "Fin", type: "date", required: true },
              ]}
            />
          </CrudSection>

          <CrudSection title="Grados">
            <EntityForm
              action={createCourseAction}
              submitLabel="Agregar grado"
              disabledReason={years.length === 0 ? "Crea primero un año académico." : undefined}
              fields={[
                {
                  name: "academicYearId",
                  label: "Año",
                  type: "select",
                  required: true,
                  options: yearOptions,
                },
                { name: "name", label: "Nombre", type: "text", required: true, placeholder: "11°" },
                { name: "code", label: "Código", type: "text", required: true, placeholder: "G11" },
              ]}
            />
          </CrudSection>

          <CrudSection title="Asignaturas">
            <EntityForm
              action={createSubjectAction}
              submitLabel="Agregar asignatura"
              fields={[
                {
                  name: "name",
                  label: "Nombre",
                  type: "text",
                  required: true,
                  placeholder: "Matemáticas",
                },
                { name: "code", label: "Código", type: "text", required: true, placeholder: "MAT" },
              ]}
            />
          </CrudSection>

          <CrudSection title="Asignaturas por grado">
            <EntityForm
              action={createCourseSubjectAction}
              submitLabel="Enlazar"
              disabledReason={
                courses.length === 0 || subjects.length === 0
                  ? "Necesitas al menos un grado y una asignatura."
                  : undefined
              }
              fields={[
                {
                  name: "courseId",
                  label: "Grado",
                  type: "select",
                  required: true,
                  options: courseOptions,
                },
                {
                  name: "subjectId",
                  label: "Asignatura",
                  type: "select",
                  required: true,
                  options: subjectOptions,
                },
              ]}
            />
          </CrudSection>

          <CrudSection title="Grupos">
            <EntityForm
              action={createGroupAction}
              submitLabel="Agregar grupo"
              disabledReason={courses.length === 0 ? "Crea primero un grado." : undefined}
              fields={[
                {
                  name: "courseId",
                  label: "Grado",
                  type: "select",
                  required: true,
                  options: courseOptions,
                },
                {
                  name: "name",
                  label: "Nombre",
                  type: "text",
                  required: true,
                  placeholder: "11-03",
                },
              ]}
            />
            {groups.length > 0 && (
              <ul className="divide-y text-sm">
                {groups.map((g) => (
                  <li key={g.id} className="flex items-center gap-3 py-2">
                    <span className="font-medium">{g.name}</span>
                    <span className="text-muted-foreground">{courseLabel.get(g.courseId)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CrudSection>
        </div>
      </details>

      {/* CTA secundario al final, junto al PageHeader (como "Nuevo año académico"
          del topbar del Pencil). Mantiene el alta rápida sin scroll. */}
      <div className="mt-6 flex justify-end">
        <Button size="sm" variant="outline">
          <Link href="/admin/academic/years/new">Nuevo año académico</Link>
        </Button>
      </div>
    </>
  );
}

function CrudSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-muted space-y-3 rounded-lg border p-4">
      <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}
