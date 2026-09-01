import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import { hasRole } from "@/shared/application/authenticated-user";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/evaluations/status-badge";
import { richTextToPlain } from "@/components/editor/render";
import { makeGetEvaluation } from "@/modules/evaluations/infrastructure/container";
import { ContextsView, type ContextCardData } from "./contexts-view";
import { SectionForm } from "../../section-form";

export const metadata = { title: "Contextos" };

/**
 * Índice de contextos de una formulación (Fase 10).
 *
 * Server component que carga la formulación completa, deriva una lista de
 * `ContextCardData` por sección y se la pasa al cliente `ContextsView`. La
 * derivación (snippet plano a partir del TipTap JSON, deduplicado de
 * competencias) se hace aquí para mantener el componente cliente puro y
 * evitar arrastrar Tiptap/KaTeX al bundle del navegador.
 */
export default async function ContextsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");
  const result = await makeGetEvaluation().execute({ actor, id });
  if (!result.ok) notFound();
  const evaluation = result.value;

  const editable =
    (evaluation.teacherId === actor.userId || hasRole(actor, "ECU_MASTER")) &&
    evaluation.status === "DRAFT";

  const contexts: ContextCardData[] = evaluation.sections.map((section) => {
    const competencies = Array.from(
      new Set(section.questions.map((q) => q.competency).filter((c): c is string => Boolean(c))),
    );
    const hasFigure = section.questions.some((q) => q.image != null);
    return {
      id: section.id,
      order: section.order,
      title: section.title,
      snippet: richTextToPlain(section.content).slice(0, 280),
      questionCount: section.questions.length,
      competencies,
      hasFigure,
    };
  });

  const totalQuestions = evaluation.totalQuestions;
  const editionLabel = totalQuestions
    ? `${totalQuestions} pregunta(s) · selecciona un contexto para editarlo`
    : "Selecciona un contexto o crea uno nuevo para empezar";

  return (
    <>
      <PageHeader
        title="Contextos"
        description={
          <>
            {evaluation.title} — {editionLabel}
          </>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <StatusBadge status={evaluation.status} />
      </div>

      <ContextsView
        evaluationId={evaluation.id}
        evaluationTitle={evaluation.title}
        editable={editable}
        contexts={contexts}
        totalQuestions={totalQuestions}
      />

      {editable ? (
        <div className="bg-card mt-8 space-y-3 rounded-xl border p-4">
          <h2 className="font-semibold">Agregar un contexto nuevo</h2>
          <SectionForm evaluationId={evaluation.id} />
        </div>
      ) : null}
    </>
  );
}
