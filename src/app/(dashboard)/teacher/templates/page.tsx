import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { makeListCourseSubjects } from "@/modules/academic/infrastructure/container";
import { makeListTemplates } from "@/modules/evaluations/infrastructure/container";
import { deleteTemplateAction } from "./actions";

export const metadata: Metadata = { title: "Plantillas" };

const df = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" });

export default async function TemplatesPage() {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER");

  const [tplRes, csRes] = await Promise.all([
    makeListTemplates().execute({ actor }),
    makeListCourseSubjects().execute({ actor }),
  ]);
  const templates = tplRes.ok ? tplRes.value : [];
  const csMap = new Map(
    (csRes.ok ? csRes.value : []).map((c) => [c.id, `${c.courseName} · ${c.subjectName}`]),
  );

  return (
    <>
      <PageHeader
        title="Plantillas de formulación"
        description="Crea plantillas reutilizables para generar formulaciones rápidamente."
      />

      <Link href="/teacher/templates/new">
        <Button size="sm">Nueva plantilla</Button>
      </Link>

      <div className="mt-4 space-y-3">
        {templates.length === 0 ? (
          <p className="text-muted-foreground text-sm">No hay plantillas todavía.</p>
        ) : (
          templates.map((tpl) => {
            const totalQ = tpl.structure.reduce((s, sec) => s + sec.numQuestions, 0);
            const sectionCount = tpl.structure.length;
            return (
              <div key={tpl.id} className="bg-card flex items-center gap-4 rounded-xl border p-4">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/teacher/templates/${tpl.id}`}
                    className="font-medium hover:underline"
                  >
                    {tpl.name}
                  </Link>
                  <p className="text-muted-foreground text-sm">
                    {csMap.get(tpl.courseSubjectId) ?? "—"} · {sectionCount} sección
                    {sectionCount !== 1 ? "es" : ""}, {totalQ} pregunta
                    {totalQ !== 1 ? "s" : ""}
                  </p>
                  {tpl.description && (
                    <p className="text-muted-foreground mt-0.5 text-xs">{tpl.description}</p>
                  )}
                  <p className="text-muted-foreground mt-1 text-xs">
                    Creada el {df.format(new Date(tpl.createdAt))}
                  </p>
                </div>
                <form action={deleteTemplateAction}>
                  <input type="hidden" name="templateId" value={tpl.id} />
                  <Button type="submit" variant="ghost" size="sm" className="text-destructive">
                    Eliminar
                  </Button>
                </form>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
