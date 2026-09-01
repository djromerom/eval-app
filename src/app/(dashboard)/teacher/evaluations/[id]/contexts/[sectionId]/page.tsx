import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/evaluations/status-badge";
import { richTextToPlain } from "@/components/editor/render";
import { makeGetEvaluation } from "@/modules/evaluations/infrastructure/container";
import { makeListCourseSubjects } from "@/modules/academic/infrastructure/container";
import { makeSearchBankQuestions } from "@/modules/question-bank/infrastructure/container";
import { env } from "@/config/env";
import { ContextEditor, type ContextEditorData } from "./context-editor";

export const metadata = { title: "Editor por contexto" };

/**
 * Editor enfocado en una sola sección (Fase 10).
 *
 * Reutiliza `GetEvaluation` igual que el editor clásico, busca la sección por
 * id y la pasa a `ContextEditor`. Las preguntas de esa sección son las únicas
 * renderizadas, junto con el banner del contexto y el panel Banco lateral.
 */
export default async function ContextEditorPage({
  params,
}: {
  params: Promise<{ id: string; sectionId: string }>;
}) {
  const { id, sectionId } = await params;
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER");
  const result = await makeGetEvaluation().execute({ actor, id });
  if (!result.ok) notFound();
  const evaluation = result.value;

  const section = evaluation.sections.find((s) => s.id === sectionId);
  if (!section) notFound();

  const isOwner = evaluation.teacherId === actor.userId;
  const editable = isOwner && evaluation.status === "DRAFT";

  // Mismo truco que el editor clásico: resolvemos subjectId para poder
  // importar del banco de preguntas filtrado por asignatura.
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

  const data: ContextEditorData = {
    evaluationId: evaluation.id,
    evaluationTitle: evaluation.title,
    evaluationStatus: evaluation.status,
    section: {
      id: section.id,
      order: section.order,
      title: section.title,
      content: section.content,
      snippet: richTextToPlain(section.content).slice(0, 320),
      columnLayoutOverride: section.columnLayoutOverride,
      questions: section.questions.map((q) => ({
        id: q.id,
        number: q.number,
        text: q.text,
        options: q.options,
        correctAnswer: q.correctAnswer,
        justification: q.justification,
        weight: q.weight,
        soloLevel: q.soloLevel,
        menComponent: q.menComponent,
        competency: q.competency,
      })),
    },
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
      <PageHeader
        title={section.title ?? `Contexto ${section.order + 1}`}
        description={
          <>
            <Link
              href={`/teacher/evaluations/${evaluation.id}/contexts`}
              className="hover:underline"
            >
              ← {evaluation.title}
            </Link>
            <span className="text-muted-foreground">
              {" · "}
              {section.questions.length} pregunta
              {section.questions.length === 1 ? "" : "s"}
              {section.questions.length > 0
                ? ` · p${section.questions[0]!.number}–p${section.questions[section.questions.length - 1]!.number}`
                : ""}
            </span>
          </>
        }
      />

      <div className="mb-4">
        <StatusBadge status={evaluation.status} />
      </div>

      <ContextEditor data={data} />
    </>
  );
}
