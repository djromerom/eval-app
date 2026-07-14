import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { makeGetEvaluation } from "@/modules/evaluations/infrastructure/container";
import { getResolvedTheme } from "@/modules/theme/application/get-resolved-theme";
import { parseEvaluationTheme } from "@/modules/theme/domain/theme";
import { DesignerForm } from "./designer-form";

export const metadata: Metadata = { title: "Diseñador" };

export const dynamic = "force-dynamic";

/**
 * Pestaña Diseñador — override del tema por evaluación + preview iframe
 * del cuadernillo real (`/print/evaluation/[id]`).
 *
 * El docente dueño (o un COORDINATOR) puede ajustar el tema sin tocar el
 * preset institucional. Solo en DRAFT (validado en UpdateEvaluationTheme).
 */
export default async function DesignerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");

  const result = await makeGetEvaluation().execute({ actor, id });
  if (!result.ok) notFound();
  const evaluation = result.value;

  const editable = evaluation.status === "DRAFT";
  const override = parseEvaluationTheme(evaluation.theme);
  const resolved = await getResolvedTheme(actor.institutionId, id);

  return (
    <>
      <PageHeader
        title={`Diseñador — ${evaluation.title}`}
        description="Personaliza el cuadernillo de esta evaluación. Los cambios se ven inmediatamente en la vista previa."
      />

      <div className="mb-4 flex items-center gap-3 text-sm">
        <Link
          href={`/teacher/evaluations/${evaluation.id}`}
          className="text-muted-foreground hover:underline"
        >
          ← Volver a la evaluación
        </Link>
        <Link
          href={`/print/evaluation/${evaluation.id}`}
          target="_blank"
          className="text-muted-foreground hover:underline"
        >
          Abrir cuadernillo en pestaña nueva ↗
        </Link>
      </div>

      <DesignerForm
        evaluationId={evaluation.id}
        initial={override}
        resolved={resolved}
        editable={editable}
      />
    </>
  );
}
