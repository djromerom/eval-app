import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import { hasRole } from "@/shared/application/authenticated-user";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/evaluations/status-badge";
import { makeGetEvaluation } from "@/modules/evaluations/infrastructure/container";
import { DEFAULT_MINUTES_PER_QUESTION } from "@/modules/bundles/domain/bundle-rules";
import { EvaluationSettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Configuración de formulación" };

export default async function EvaluationSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");
  const result = await makeGetEvaluation().execute({ actor, id });
  if (!result.ok) notFound();
  const evaluation = result.value;

  const isOwner = evaluation.teacherId === actor.userId;
  // ECU_MASTER puede editar el contenido de cualquier evaluación DRAFT de su
  // institución aunque NO sea el autor (coherente con UpdateEvaluationSettings).
  const editable = (isOwner || hasRole(actor, "ECU_MASTER")) && evaluation.status === "DRAFT";

  const fallbackMinutes = Math.round(evaluation.totalQuestions * DEFAULT_MINUTES_PER_QUESTION);

  return (
    <>
      <PageHeader
        title="Configuración"
        description={`${evaluation.title} · v${evaluation.version}`}
      />

      <div className="mb-6 flex items-center gap-3">
        <StatusBadge status={evaluation.status} />
        <span className="text-muted-foreground text-sm">
          {evaluation.totalQuestions} pregunta(s)
        </span>
        <Link
          href={`/teacher/evaluations/${evaluation.id}/contexts`}
          className="text-muted-foreground ml-auto text-sm hover:underline"
        >
          ← Volver a la formulación
        </Link>
      </div>

      <EvaluationSettingsForm
        evaluationId={evaluation.id}
        initialDurationMinutes={evaluation.durationMinutes}
        editable={editable}
        totalQuestions={evaluation.totalQuestions}
        minutesPerQuestion={DEFAULT_MINUTES_PER_QUESTION}
      />

      <section className="bg-muted/30 mt-6 rounded-xl border p-4 text-sm">
        <h3 className="mb-1 font-semibold">Cómo se usa</h3>
        <p className="text-muted-foreground">
          Si dejas el campo vacío, la portada del cuadernillo calcula la duración como{" "}
          <code>
            {evaluation.totalQuestions} × {DEFAULT_MINUTES_PER_QUESTION} = {fallbackMinutes} min
          </code>
          . Si capturas un valor explícito, ese es el que aparece. Ambos casos son editables
          mientras la formulación esté en BORRADOR; al aprobarse, la duración se congela.
        </p>
      </section>
    </>
  );
}
