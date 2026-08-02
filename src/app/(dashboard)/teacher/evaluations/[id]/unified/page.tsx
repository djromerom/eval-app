import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/evaluations/status-badge";
import { richTextToPlain } from "@/components/editor/render";
import { makeGetEvaluation } from "@/modules/evaluations/infrastructure/container";
import { makeListCourseSubjects } from "@/modules/academic/infrastructure/container";
import { makeSearchBankQuestions } from "@/modules/question-bank/infrastructure/container";
import { env } from "@/config/env";
import { UnifiedEditor, type UnifiedEditorData } from "./unified-editor";

export const metadata: Metadata = { title: "Formulación unificada" };

/**
 * Tercera vista del editor: un solo formulario grande arriba + tabla resumen
 * abajo. NO toca las rutas legacy:
 *   - /teacher/evaluations/[id] (editor todo-a-la-vez)
 *   - /teacher/evaluations/[id]/contexts (vista de cards)
 *
 * Persiste contra el mismo modelo Prisma (Evaluation + Section + Question),
 * así que los cambios aquí se reflejan en las otras vistas.
 */
export default async function UnifiedEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");
  const result = await makeGetEvaluation().execute({ actor, id });
  if (!result.ok) notFound();
  const evaluation = result.value;

  const isOwner = evaluation.teacherId === actor.userId;
  const editable = isOwner && evaluation.status === "DRAFT";

  // Mismo truco que las otras vistas: resolver subjectId para filtrar banco.
  const csRes = await makeListCourseSubjects().execute({ actor });
  const subjectId =
    (csRes.ok ? csRes.value.find((c) => c.id === evaluation.courseSubjectId) : undefined)
      ?.subjectId ?? "";

  const bankRes = editable
    ? await makeSearchBankQuestions().execute({
        actor,
        filters: subjectId ? { subjectId } : {},
      })
    : null;
  const bankQuestions = bankRes?.ok ? bankRes.value : [];

  const data: UnifiedEditorData = {
    evaluationId: evaluation.id,
    evaluationTitle: evaluation.title,
    evaluationStatus: evaluation.status,
    sections: evaluation.sections.map((s) => ({
      id: s.id,
      order: s.order,
      title: s.title,
      content: s.content,
      questions: s.questions.map((q) => ({
        id: q.id,
        number: q.number,
        sectionId: s.id,
        text: q.text,
        options: q.options.map((o) => ({ key: o.key, text: o.text })),
        correctAnswer: q.correctAnswer,
      })),
    })),
    editable,
    bankQuestions: bankQuestions.map((bq) => ({
      id: bq.id,
      text: richTextToPlain(bq.text).slice(0, 80),
    })),
    defaultOptions: env.EVAL_DEFAULT_OPTIONS,
    maxOptions: env.EVAL_MAX_OPTIONS,
  };

  return (
    <>
      <PageHeader title={`${evaluation.title} — formulación unificada`} />

      <div className="mb-4 flex items-center gap-3">
        <StatusBadge status={evaluation.status} />
        <span className="text-muted-foreground text-sm">{evaluation.totalQuestions} ítem(s)</span>
      </div>

      <UnifiedEditor data={data} />
    </>
  );
}
