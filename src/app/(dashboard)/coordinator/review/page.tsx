import type { Metadata } from "next";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/evaluations/status-badge";
import { makeListEvaluations } from "@/modules/evaluations/infrastructure/container";
import type { EvaluationListItem } from "@/modules/evaluations/domain/evaluation";
import { approveAction, publishAction } from "./actions";
import { RejectForm } from "./reject-form";

export const metadata: Metadata = { title: "Revisión" };

function Row({ e, children }: { e: EvaluationListItem; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
      <div className="min-w-0">
        <p className="font-medium">{e.title}</p>
        <p className="text-muted-foreground text-sm">
          {e.courseName} · {e.subjectName} — {e.totalQuestions} pregunta(s) · v{e.version}
        </p>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <StatusBadge status={e.status} />
        {children}
      </div>
    </div>
  );
}

export default async function ReviewPage() {
  const actor = await requireAuthenticatedUser("ECU_LIDER");
  const [inReviewRes, approvedRes] = await Promise.all([
    makeListEvaluations().execute({ actor, status: "IN_REVIEW" }),
    makeListEvaluations().execute({ actor, status: "APPROVED" }),
  ]);
  const inReview = inReviewRes.ok ? inReviewRes.value : [];
  const approved = approvedRes.ok ? approvedRes.value : [];

  return (
    <>
      <PageHeader
        title="Revisión de formulaciones"
        description="Aprueba o rechaza (con comentario) las formulaciones enviadas por los docentes."
      />

      <section className="space-y-3">
        <h2 className="font-semibold">Pendientes de revisión ({inReview.length})</h2>
        {inReview.length === 0 ? (
          <p className="text-muted-foreground text-sm">No hay formulaciones en revisión.</p>
        ) : (
          inReview.map((e) => (
            <Row key={e.id} e={e}>
              <form action={approveAction}>
                <input type="hidden" name="evaluationId" value={e.id} />
                <Button type="submit" size="sm">
                  Aprobar
                </Button>
              </form>
              <RejectForm evaluationId={e.id} />
            </Row>
          ))
        )}
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="font-semibold">Aprobadas — listas para publicar ({approved.length})</h2>
        {approved.length === 0 ? (
          <p className="text-muted-foreground text-sm">No hay formulaciones aprobadas.</p>
        ) : (
          approved.map((e) => (
            <Row key={e.id} e={e}>
              <form action={publishAction}>
                <input type="hidden" name="evaluationId" value={e.id} />
                <Button type="submit" size="sm">
                  Publicar
                </Button>
              </form>
            </Row>
          ))
        )}
      </section>
    </>
  );
}
