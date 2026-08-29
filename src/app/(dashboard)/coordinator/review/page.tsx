import type { Metadata } from "next";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/evaluations/status-badge";
import { makeListEvaluations } from "@/modules/evaluations/infrastructure/container";
import type { EvaluationListItem } from "@/modules/evaluations/domain/evaluation";
import type { EvaluationStatus } from "@/modules/evaluations/domain/evaluation-status";
import { approveAction, publishAction, revertAction } from "./actions";
import { RejectForm } from "./reject-form";
import { REVIEW_FILTER_OPTIONS } from "./review-constants";
import { StatusFilter } from "./status-filter";

export const metadata: Metadata = { title: "Revisión" };

/** Estado por defecto del módulo de revisión. IN_REVIEW es la entrada
 *  natural del flujo (los docentes envían formulaciones, el líder las
 *  revisa). El filtro dropdown (StatusFilter) usa este default si la URL
 *  no trae `?status=...`. */
const DEFAULT_STATUS: EvaluationStatus = "IN_REVIEW";

function isValidStatus(value: string | undefined): value is EvaluationStatus {
  return value === "IN_REVIEW" || value === "APPROVED" || value === "PUBLISHED";
}

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

/** Renderiza los botones que apliquen al estado visible de la fila. La sección
 *  actual está implícita en `currentStatus` (pasada por page.tsx). */
function ActionsFor({ status, evaluationId }: { status: EvaluationStatus; evaluationId: string }) {
  if (status === "IN_REVIEW") {
    return (
      <>
        <form action={approveAction}>
          <input type="hidden" name="evaluationId" value={evaluationId} />
          <Button type="submit" size="sm">
            Aprobar
          </Button>
        </form>
        <RejectForm evaluationId={evaluationId} />
      </>
    );
  }
  if (status === "APPROVED") {
    return (
      <>
        <form action={publishAction}>
          <input type="hidden" name="evaluationId" value={evaluationId} />
          <Button type="submit" size="sm">
            Publicar
          </Button>
        </form>
        {/* Reutiliza RejectForm: la transición `APPROVED → DRAFT` para
            ECU_LIDER también exige comentario (rechazo tardío). */}
        <RejectForm
          evaluationId={evaluationId}
          label="Volver a borrador"
          pendingLabel="Volviendo…"
        />
      </>
    );
  }
  // PUBLISHED: solo botón de rollback (sin comment).
  return (
    <form action={revertAction}>
      <input type="hidden" name="evaluationId" value={evaluationId} />
      <Button type="submit" size="sm" variant="outline">
        Volver a borrador
      </Button>
    </form>
  );
}

type SearchParams = Promise<{ status?: string }>;

export default async function ReviewPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAuthenticatedUser("ECU_LIDER");
  const params = await searchParams;
  const currentStatus: EvaluationStatus = isValidStatus(params.status)
    ? params.status
    : DEFAULT_STATUS;

  const res = await makeListEvaluations().execute({ actor, status: currentStatus });
  const evaluations = res.ok ? res.value : [];

  const sectionTitle = REVIEW_FILTER_OPTIONS.find((o) => o.value === currentStatus)?.label ?? "";

  return (
    <>
      <PageHeader
        title="Revisión de formulaciones"
        description="Aprueba o rechaza (con comentario) las formulaciones enviadas por los docentes."
      />

      <div className="mb-4 flex items-center gap-3">
        <label htmlFor="status-filter" className="text-sm font-medium">
          Filtrar por estado:
        </label>
        <StatusFilter current={currentStatus} />
        <span className="text-muted-foreground text-sm">({evaluations.length})</span>
      </div>

      <section className="space-y-3">
        <h2 className="font-semibold">
          {sectionTitle} ({evaluations.length})
        </h2>
        {evaluations.length === 0 ? (
          <p className="text-muted-foreground text-sm">No hay formulaciones en este estado.</p>
        ) : (
          evaluations.map((e) => (
            <Row key={e.id} e={e}>
              <ActionsFor status={currentStatus} evaluationId={e.id} />
            </Row>
          ))
        )}
      </section>
    </>
  );
}
