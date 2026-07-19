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

export const metadata: Metadata = { title: "Estructura académica" };

const df = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" });

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-card space-y-4 rounded-xl border p-6">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="text-muted-foreground text-sm">{label}</p>;
}

export default async function AcademicPage() {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const { years, periods, courses, subjects, groups, courseSubjects } = await loadAll(actor);

  const yearOptions = years.map((y) => ({ value: y.id, label: String(y.year) }));
  const courseOptions = courses.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }));
  const subjectOptions = subjects.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }));
  const yearLabel = new Map(years.map((y) => [y.id, String(y.year)]));
  const courseLabel = new Map(courses.map((c) => [c.id, c.name]));

  return (
    <>
      <PageHeader
        title="Estructura académica"
        description="Años, periodos, cursos, asignaturas y grupos de tu institución (ADMIN)."
      />

      <div className="space-y-6">
        <Section title="Años académicos">
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
          {years.length === 0 ? (
            <Empty label="Aún no hay años académicos." />
          ) : (
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
        </Section>

        <Section title="Periodos">
          <EntityForm
            action={createPeriodAction}
            submitLabel="Agregar periodo"
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
                placeholder: "I Periodo",
              },
              { name: "order", label: "Orden", type: "number", required: true, placeholder: "1" },
              { name: "startDate", label: "Inicio", type: "date", required: true },
              { name: "endDate", label: "Fin", type: "date", required: true },
            ]}
          />
          {periods.length === 0 ? (
            <Empty label="Aún no hay periodos." />
          ) : (
            <ul className="divide-y text-sm">
              {periods.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2">
                  <span className="text-muted-foreground">{p.order}.</span>
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground">{yearLabel.get(p.academicYearId)}</span>
                  <span className="text-muted-foreground">
                    {df.format(p.startDate)} – {df.format(p.endDate)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Cursos">
          <EntityForm
            action={createCourseAction}
            submitLabel="Agregar curso"
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
          {courses.length === 0 ? (
            <Empty label="Aún no hay cursos." />
          ) : (
            <ul className="divide-y text-sm">
              {courses.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-2">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-muted-foreground">{c.code}</span>
                  <span className="text-muted-foreground">{yearLabel.get(c.academicYearId)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Asignaturas">
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
          {subjects.length === 0 ? (
            <Empty label="Aún no hay asignaturas." />
          ) : (
            <ul className="divide-y text-sm">
              {subjects.map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-2">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-muted-foreground">{s.code}</span>
                  {s.institutionId === null ? (
                    <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                      Global
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Asignaturas por curso">
          <EntityForm
            action={createCourseSubjectAction}
            submitLabel="Enlazar"
            disabledReason={
              courses.length === 0 || subjects.length === 0
                ? "Necesitas al menos un curso y una asignatura."
                : undefined
            }
            fields={[
              {
                name: "courseId",
                label: "Curso",
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
          {courseSubjects.length === 0 ? (
            <Empty label="Aún no hay asignaturas enlazadas a cursos." />
          ) : (
            <ul className="divide-y text-sm">
              {courseSubjects.map((cs) => (
                <li key={cs.id} className="flex items-center gap-3 py-2">
                  <span className="font-medium">{cs.courseName}</span>
                  <span className="text-muted-foreground">·</span>
                  <span>{cs.subjectName}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Grupos">
          <EntityForm
            action={createGroupAction}
            submitLabel="Agregar grupo"
            disabledReason={courses.length === 0 ? "Crea primero un curso." : undefined}
            fields={[
              {
                name: "courseId",
                label: "Curso",
                type: "select",
                required: true,
                options: courseOptions,
              },
              { name: "name", label: "Nombre", type: "text", required: true, placeholder: "11-03" },
            ]}
          />
          {groups.length === 0 ? (
            <Empty label="Aún no hay grupos." />
          ) : (
            <ul className="divide-y text-sm">
              {groups.map((g) => (
                <li key={g.id} className="flex items-center gap-3 py-2">
                  <span className="font-medium">{g.name}</span>
                  <span className="text-muted-foreground">{courseLabel.get(g.courseId)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
