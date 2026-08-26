import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { makeGetEvaluation } from "@/modules/evaluations/infrastructure/container";
import { makeListEvaluations } from "@/modules/evaluations/infrastructure/container";
import { makeListSubjects } from "@/modules/academic/infrastructure/container";
import { ImportWizard } from "./wizard";

export const metadata: Metadata = { title: "Importar preguntas" };

export default async function ImportQuestionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: targetId } = await params;
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER");

  // La formulación destino tiene que existir y estar en BORRADOR (el use case
  // también lo comprueba, pero así evitamos mostrar el wizard si no va a
  // poder terminar).
  const targetRes = await makeGetEvaluation().execute({ actor, id: targetId });
  if (!targetRes.ok) notFound();
  const target = targetRes.value;
  const editable = target.teacherId === actor.userId && target.status === "DRAFT";

  // Lista de formulaciones origen: las del propio docente, distintas del
  // target, y con al menos una pregunta.
  const allRes = await makeListEvaluations().execute({ actor });
  const sources = (allRes.ok ? allRes.value : [])
    .filter((e) => e.id !== targetId && e.totalQuestions > 0)
    .map((e) => ({
      id: e.id,
      title: e.title,
      subjectName: e.subjectName,
      totalQuestions: e.totalQuestions,
    }));

  // Asignaturas para el destino "banco".
  const subjectsRes = await makeListSubjects().execute({ actor });
  const subjects = subjectsRes.ok ? subjectsRes.value : [];

  return (
    <>
      <PageHeader
        title="Importar preguntas"
        description={`A "${target.title}" (versión ${target.version})`}
      />

      <p className="text-muted-foreground mb-6 text-sm">
        <Link href={`/teacher/evaluations/${target.id}/unified`} className="hover:underline">
          ← Volver a la formulación
        </Link>
      </p>

      {!editable ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-sm">
          Solo el docente autor puede importar preguntas en una formulación en BORRADOR.
        </p>
      ) : (
        <ImportWizard
          targetEvaluationId={target.id}
          sources={sources}
          sections={target.sections.map((s) => ({
            id: s.id,
            title: s.title ?? `Contexto ${s.order + 1}`,
          }))}
          subjects={subjects}
        />
      )}
    </>
  );
}
