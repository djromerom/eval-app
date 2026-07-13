import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/evaluations/status-badge";
import { RichText, RichTextInline } from "@/components/editor/rich-text";
import { richTextToPlain } from "@/components/editor/render";
import { makeGetEvaluation } from "@/modules/evaluations/infrastructure/container";
import { makeListCourseSubjects } from "@/modules/academic/infrastructure/container";
import { makeSearchBankQuestions } from "@/modules/question-bank/infrastructure/container";
import { QuestionForm } from "../question-form";
import { SectionForm } from "../section-form";
import { submitForReviewAction } from "../actions";
import { exportQuestionToBankAction, importBankQuestionAction } from "../../question-bank/actions";

const controlClass =
  "h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none";

export const metadata: Metadata = { title: "Evaluación" };

export default async function EvaluationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");
  const result = await makeGetEvaluation().execute({ actor, id });
  if (!result.ok) notFound();
  const evaluation = result.value;

  const isOwner = evaluation.teacherId === actor.userId;
  const editable = isOwner && evaluation.status === "DRAFT";

  // Resuelve la asignatura de la evaluación para importar/exportar del banco.
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

  return (
    <>
      <PageHeader title={evaluation.title} description={`Versión ${evaluation.version}`} />

      <div className="mb-6 flex items-center gap-3">
        <StatusBadge status={evaluation.status} />
        <span className="text-muted-foreground text-sm">
          {evaluation.totalQuestions} pregunta(s)
        </span>
        <Link
          href={`/teacher/evaluations/${evaluation.id}/generate-sheets`}
          className="text-muted-foreground ml-auto text-sm hover:underline"
        >
          Generar hojas →
        </Link>
        <Link
          href={`/teacher/evaluations/${evaluation.id}/results`}
          className="text-muted-foreground text-sm hover:underline"
        >
          Resultados →
        </Link>
        <Link
          href={`/print/evaluation/${evaluation.id}`}
          target="_blank"
          className="text-muted-foreground text-sm hover:underline"
        >
          Cartilla ↗
        </Link>
        <Link
          href={`/print/answer-sheet/${evaluation.id}`}
          target="_blank"
          className="text-muted-foreground text-sm hover:underline"
        >
          Hoja respuestas ↗
        </Link>
        <Link
          href={`/print/answer-key/${evaluation.id}`}
          target="_blank"
          className="text-muted-foreground text-sm hover:underline"
        >
          Clave ↗
        </Link>
        <Link href="/teacher/evaluations" className="text-muted-foreground text-sm hover:underline">
          ← Volver
        </Link>
      </div>

      {editable ? (
        <div className="bg-card mb-6 space-y-4 rounded-xl border p-4">
          <SectionForm evaluationId={evaluation.id} />
          {evaluation.totalQuestions > 0 ? (
            <form action={submitForReviewAction}>
              <input type="hidden" name="evaluationId" value={evaluation.id} />
              <Button type="submit" size="sm">
                Enviar a revisión
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}

      {evaluation.sections.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {editable
            ? "Aún no hay bloques. Agrega uno para empezar a añadir preguntas."
            : "Esta evaluación no tiene contenido."}
        </p>
      ) : (
        <div className="space-y-8">
          {evaluation.sections.map((section) => (
            <section key={section.id} className="space-y-4">
              <h2 className="border-b pb-2 font-semibold">
                {section.title ?? `Bloque ${section.order + 1}`}
              </h2>
              <RichText value={section.content} className="text-muted-foreground" />

              {section.questions.map((q) => (
                <div key={q.id} className="rounded-lg border p-4">
                  <div className="flex gap-1 font-medium">
                    <span>{q.number}.</span>
                    <RichTextInline value={q.text} />
                  </div>
                  <ul className="mt-2 space-y-1 text-sm">
                    {q.options.map((o) => (
                      <li
                        key={o.key}
                        className={
                          o.key === q.correctAnswer
                            ? "text-primary font-medium"
                            : "text-muted-foreground"
                        }
                      >
                        {o.key}) <RichTextInline value={o.text} />
                        {o.key === q.correctAnswer ? " ✓" : ""}
                      </li>
                    ))}
                  </ul>
                  {q.soloLevel || q.menComponent ? (
                    <p className="text-muted-foreground mt-2 text-xs">
                      {q.soloLevel ?? ""} {q.menComponent ? `· ${q.menComponent}` : ""}
                    </p>
                  ) : null}
                  {isOwner && subjectId ? (
                    <form action={exportQuestionToBankAction} className="mt-2">
                      <input type="hidden" name="evaluationId" value={evaluation.id} />
                      <input type="hidden" name="questionId" value={q.id} />
                      <input type="hidden" name="subjectId" value={subjectId} />
                      <Button type="submit" size="sm" variant="ghost">
                        Exportar al banco
                      </Button>
                    </form>
                  ) : null}
                </div>
              ))}

              {editable && bankQuestions.length > 0 ? (
                <form action={importBankQuestionAction} className="flex items-end gap-2">
                  <input type="hidden" name="evaluationId" value={evaluation.id} />
                  <input type="hidden" name="sectionId" value={section.id} />
                  <select name="bankQuestionId" required className={controlClass}>
                    {bankQuestions.map((bq) => (
                      <option key={bq.id} value={bq.id}>
                        {richTextToPlain(bq.text).slice(0, 70)}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" size="sm" variant="outline">
                    Importar del banco
                  </Button>
                </form>
              ) : null}

              {editable ? (
                <QuestionForm evaluationId={evaluation.id} sectionId={section.id} />
              ) : null}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
