import type { Metadata } from "next";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/evaluations/status-badge";
import { makeListEvaluations } from "@/modules/evaluations/infrastructure/container";
import { makeGetCurrentPeriod } from "@/modules/academic/infrastructure/container";
import type { EvaluationListItem } from "@/modules/evaluations/domain/evaluation";
import type { EvaluationStatus } from "@/modules/evaluations/domain/evaluation-status";
import { approveAction, publishAction, revertAction } from "./actions";
import { RejectForm } from "./reject-form";
import { ReviewActionButton } from "./review-action-button";
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
 *  actual está implícita en `currentStatus` (pasada por page.tsx).
 *
 *  Sprint 2026-08-30: cada acción dispara un `toast.success` al terminar
 *  OK (ver `review-action-button.tsx` y la prop `successMessage` de
 *  `RejectForm`). */
function ActionsFor({ status, evaluationId }: { status: EvaluationStatus; evaluationId: string }) {
  if (status === "IN_REVIEW") {
    return (
      <>
        <ReviewActionButton
          action={approveAction}
          evaluationId={evaluationId}
          successMessage="Formulación aprobada"
          label="Aprobar"
          pendingLabel="Aprobando…"
        />
        <RejectForm evaluationId={evaluationId} />
      </>
    );
  }
  if (status === "APPROVED") {
    return (
      <>
        <ReviewActionButton
          action={publishAction}
          evaluationId={evaluationId}
          successMessage="Formulación publicada"
          label="Publicar"
          pendingLabel="Publicando…"
        />
        {/* Reutiliza RejectForm: la transición `APPROVED → DRAFT` para
            ECU_LIDER también exige comentario (rechazo tardío). */}
        <RejectForm
          evaluationId={evaluationId}
          label="Volver a borrador"
          pendingLabel="Volviendo…"
          successMessage="Formulación revertida a borrador"
        />
      </>
    );
  }
  // PUBLISHED: solo botón de rollback (sin comment).
  return (
    <ReviewActionButton
      action={revertAction}
      evaluationId={evaluationId}
      successMessage="Formulación revertida a borrador"
      label="Volver a borrador"
      pendingLabel="Volviendo…"
      variant="outline"
    />
  );
}

type SearchParams = Promise<{ status?: string }>;

export default async function ReviewPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAuthenticatedUser("ECU_LIDER");
  const params = await searchParams;
  const currentStatus: EvaluationStatus = isValidStatus(params.status)
    ? params.status
    : DEFAULT_STATUS;

  // La revisión se acota a la PRUEBA ACTUAL (la marcada con `isCurrent`),
  // para que el líder revise lo que los docentes están formulando ahora y
  // no las formulaciones de pruebas anteriores. Si la institución no tiene
  // ninguna prueba actual marcada, no se filtra (mismo criterio que
  // "Mis formulaciones").
  const currentPeriodRes = await makeGetCurrentPeriod().execute({ actor });
  const currentPeriod = currentPeriodRes.ok ? currentPeriodRes.value : null;

  const res = await makeListEvaluations().execute({
    actor,
    status: currentStatus,
    periodId: currentPeriod?.id,
  });
  const evaluations = res.ok ? res.value : [];

  const sectionTitle = REVIEW_FILTER_OPTIONS.find((o) => o.value === currentStatus)?.label ?? "";

  return (
    <>
      <PageHeader
        title="Revisión de formulaciones"
        description="Aprueba o rechaza (con comentario) las formulaciones enviadas por los docentes."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label htmlFor="status-filter" className="text-sm font-medium">
          Filtrar por estado:
        </label>
        <StatusFilter current={currentStatus} />
        <span className="text-muted-foreground text-sm">({evaluations.length})</span>
        {currentPeriod ? (
          <span className="text-muted-foreground text-sm">Prueba actual: {currentPeriod.name}</span>
        ) : null}
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
