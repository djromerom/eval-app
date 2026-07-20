import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { makeGetEvaluation } from "@/modules/evaluations/infrastructure/container";
import { makeListEvaluations } from "@/modules/evaluations/infrastructure/container";
import { makeListSubjects } from "@/modules/academic/infrastructure/container";
import { ImportReviewForm } from "./review-form";
import { pickSourceAction } from "./actions";

export const metadata: Metadata = { title: "Importar preguntas" };

const selectClass =
  "h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none";

export default async function ImportQuestionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ source?: string }>;
}) {
  const { id: targetId } = await params;
  const sp = await searchParams;
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");

  // La evaluación a la que se van a importar las preguntas tiene que existir
  // y estar en BORRADOR (el use case también lo comprueba, pero así evitamos
  // mostrar el wizard si no va a poder terminar).
  const targetRes = await makeGetEvaluation().execute({ actor, id: targetId });
  if (!targetRes.ok) notFound();
  const target = targetRes.value;
  const editable = target.teacherId === actor.userId && target.status === "DRAFT";

  // Lista de evaluaciones origen: las del propio docente (no del propio target,
  // no sin preguntas). En Fase 2-4 aquí aparecerán también CSV/DOCX/PDF.
  const allRes = await makeListEvaluations().execute({ actor });
  const sources = (allRes.ok ? allRes.value : []).filter(
    (e) => e.id !== targetId && e.totalQuestions > 0,
  );

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
        <Link href={`/teacher/evaluations/${target.id}`} className="hover:underline">
          ← Volver a la evaluación
        </Link>
      </p>

      {!editable ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-sm">
          Solo el docente autor puede importar preguntas en una evaluación en BORRADOR.
        </p>
      ) : sp.source ? (
        <ImportReviewForm
          targetEvaluationId={target.id}
          sections={target.sections.map((s) => ({
            id: s.id,
            title: s.title ?? `Contexto ${s.order + 1}`,
          }))}
          subjects={subjects}
          sourceEvaluationId={sp.source}
        />
      ) : sources.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-sm">
          Aún no tienes otras evaluaciones con preguntas que puedas importar.
        </p>
      ) : (
        <section className="bg-card space-y-3 rounded-xl border p-6">
          <h2 className="font-semibold">Elige la evaluación de origen</h2>
          <p className="text-muted-foreground text-sm">
            Se copiarán sus preguntas. Podrás revisar y descartar antes de confirmar.
          </p>
          <form action={pickSourceAction} className="flex items-end gap-3">
            <input type="hidden" name="targetEvaluationId" value={targetId} />
            <div className="flex-1 space-y-1">
              <label className="text-muted-foreground block text-xs font-medium">
                Evaluación origen
              </label>
              <select name="evaluationId" required className={`${selectClass} w-full`}>
                {sources.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title} · {e.subjectName} · {e.totalQuestions} pregunta(s)
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="bg-primary text-primary-foreground hover:bg-primary/90 h-9 rounded-md px-4 text-sm font-medium"
            >
              Usar esta evaluación →
            </button>
          </form>
        </section>
      )}
    </>
  );
}
