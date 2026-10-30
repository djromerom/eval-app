import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import { hasRole } from "@/shared/application/authenticated-user";
import { PageHeader } from "@/components/page-header";
import { Breadcrumb } from "@/components/breadcrumb";
import { StatusBadge } from "@/components/evaluations/status-badge";
import { richTextToPlain } from "@/components/editor/render";
import { makeGetEvaluation } from "@/modules/evaluations/infrastructure/container";
import { makeListCourseSubjects } from "@/modules/academic/infrastructure/container";
import { makeSearchBankQuestions } from "@/modules/question-bank/infrastructure/container";
import { makeFindRuleForEvaluation } from "@/modules/evaluation-rules/infrastructure/container";
import { makeResolveOptionsRangeForEvaluation } from "@/modules/option-rules/infrastructure/container";
import { initialOptionsCount } from "@/modules/option-rules/domain/option-rule";
import { EvaluationRuleBanner, type EvaluationRuleBannerData } from "./evaluation-rule-banner";
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
export default async function UnifiedEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");
  const result = await makeGetEvaluation().execute({ actor, id });
  if (!result.ok) notFound();
  const evaluation = result.value;

  const isOwner = evaluation.teacherId === actor.userId;
  // ECU_MASTER (super admin) puede editar el contenido de cualquier
  // evaluación DRAFT de su institución aunque NO sea el autor.
  const editable = (isOwner || hasRole(actor, "ECU_MASTER")) && evaluation.status === "DRAFT";
  // Cuando el docente llega desde el listado "Mis formulaciones" (?from=list),
  // la card de creación/edición arranca OCULTA. El listado es un índice: el
  // docente hace click para entrar a editar UN ítem puntual, no a llenar el
  // formulario gigante. Mantener la card abierta por default ahí era ruido.
  // El docente la abre cuando quiera con "Agregar 1 a 1" (el botón sigue
  // visible arriba en el switcher de modo).
  const initialHideForm = from === "list";

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

  // Banner soft de regla de conteo exacto (ago 2026). Se calcula
  // independientemente de `editable` para que el docente lo vea también en
  // evaluaciones IN_REVIEW / APPROVED (saber que la regla existe, aunque
  // ya no pueda editar).
  const ruleRes = await makeFindRuleForEvaluation().execute({ actor, evaluationId: id });
  const ruleBannerData: EvaluationRuleBannerData | null =
    ruleRes.ok && ruleRes.value
      ? {
          hasRule: true,
          exactQuestions: ruleRes.value.exactQuestions,
          currentQuestions: evaluation.totalQuestions,
          delta: evaluation.totalQuestions - ruleRes.value.exactQuestions,
        }
      : null;

  // Rango de opciones de respuesta permitido para esta (Prueba × Asignatura).
  // Sin regla, el default es estricto: exactamente 4 opciones.
  const rangeRes = await makeResolveOptionsRangeForEvaluation().execute({
    actor,
    courseSubjectId: evaluation.courseSubjectId,
    periodId: evaluation.periodId,
  });
  const optionsRange = rangeRes.ok ? rangeRes.value : { min: 4, max: 4 };

  const data: UnifiedEditorData = {
    evaluationId: evaluation.id,
    evaluationTitle: evaluation.title,
    evaluationStatus: evaluation.status,
    initialHideForm,
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
    defaultOptions: initialOptionsCount(optionsRange),
    minOptions: optionsRange.min,
    maxOptions: optionsRange.max,
  };

  return (
    <>
      {/* Migas de pan: Mis formulaciones / Formular ítem. Reusa el
          componente <Breadcrumb> compartido (src/components/breadcrumb.tsx).
          El link a "Mis formulaciones" no lleva ?from=list porque el destino
          de la migas es el LISTADO, no el editor; el listado es el que
          pone ?from=list en los enlaces HACIA el editor. */}
      <Breadcrumb
        items={[
          { label: "Mis formulaciones", href: "/teacher/evaluations" },
          { label: "Formular ítem" },
        ]}
      />
      <PageHeader
        title={[
          evaluation.periodName,
          [evaluation.subjectName, evaluation.courseName].filter(Boolean).join(" "),
          evaluation.bookletTypeName,
        ]
          .filter((part) => part && String(part).trim().length > 0)
          .join(" ")}
      />

      <div className="mb-4 flex items-center gap-3">
        <StatusBadge status={evaluation.status} />
        <span className="text-muted-foreground text-sm">{evaluation.totalQuestions} ítem(s)</span>
      </div>

      {ruleBannerData && <EvaluationRuleBanner data={ruleBannerData} />}

      <UnifiedEditor data={data} />
    </>
  );
}
