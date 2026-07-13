import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { makeListCourseSubjects } from "@/modules/academic/infrastructure/container";
import {
  makeGetTemplate,
  makeListEvaluations,
} from "@/modules/evaluations/infrastructure/container";
import { applyTemplateAction } from "../actions";

export const metadata: Metadata = { title: "Plantilla" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function TemplateDetailPage({ params }: Props) {
  const { id } = await params;
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");

  const [tplRes, csRes, evalRes] = await Promise.all([
    makeGetTemplate().execute({ actor, id }),
    makeListCourseSubjects().execute({ actor }),
    makeListEvaluations().execute({ actor }),
  ]);
  if (!tplRes.ok) notFound();

  const tpl = tplRes.value;
  const csMap = new Map(
    (csRes.ok ? csRes.value : []).map((c) => [c.id, `${c.courseName} · ${c.subjectName}`]),
  );
  const draftEvaluations = (evalRes.ok ? evalRes.value : []).filter((e) => e.status === "DRAFT");
  const totalQ = tpl.structure.reduce((s, sec) => s + sec.numQuestions, 0);

  return (
    <>
      <PageHeader title={tpl.name} description={csMap.get(tpl.courseSubjectId) ?? "—"} />

      <div className="mb-4">
        <Link href="/teacher/templates" className="text-muted-foreground text-sm hover:underline">
          ← Volver a plantillas
        </Link>
      </div>

      {tpl.description && <p className="text-muted-foreground mb-4 text-sm">{tpl.description}</p>}

      <div className="bg-card mb-6 rounded-xl border p-4">
        <h3 className="mb-3 font-semibold">
          Estructura ({tpl.structure.length} sección{tpl.structure.length !== 1 ? "es" : ""},{" "}
          {totalQ} pregunta{totalQ !== 1 ? "s" : ""})
        </h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground border-b text-left text-xs uppercase">
              <th className="pr-3 pb-2 font-medium">#</th>
              <th className="pr-3 pb-2 font-medium">Sección</th>
              <th className="pb-2 font-medium">Preguntas</th>
            </tr>
          </thead>
          <tbody>
            {tpl.structure.map((sec, idx) => (
              <tr key={idx} className="border-b last:border-0">
                <td className="py-2 pr-3 font-mono text-xs">{idx + 1}</td>
                <td className="py-2 pr-3">{sec.title || "—"}</td>
                <td className="py-2 pr-3">{sec.numQuestions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-card rounded-xl border p-4">
        <h3 className="mb-3 font-semibold">Aplicar a una evaluación</h3>
        {draftEvaluations.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No hay evaluaciones en borrador. Crea una evaluación primero y luego aplica esta
            plantilla.
          </p>
        ) : (
          <form action={applyTemplateAction} className="flex items-end gap-3">
            <input type="hidden" name="templateId" value={tpl.id} />
            <div className="flex-1 space-y-1">
              <label className="text-muted-foreground block text-xs font-medium">
                Evaluación en borrador
              </label>
              <select
                name="evaluationId"
                required
                className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
              >
                <option value="">Seleccionar…</option>
                {draftEvaluations.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" size="sm">
              Aplicar plantilla
            </Button>
          </form>
        )}
        <p className="text-muted-foreground mt-2 text-xs">
          Al aplicar la plantilla se agregarán las secciones y preguntas vacías a la evaluación
          seleccionada.
        </p>
      </div>
    </>
  );
}
