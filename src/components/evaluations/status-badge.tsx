import type { EvaluationStatus } from "@/modules/evaluations/domain/evaluation-status";

const STYLES: Record<EvaluationStatus, { label: string; className: string }> = {
  DRAFT: { label: "Borrador", className: "bg-muted text-muted-foreground" },
  IN_REVIEW: {
    label: "En revisión",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  APPROVED: { label: "Aprobada", className: "bg-blue-500/15 text-blue-700 dark:text-blue-400" },
  PUBLISHED: { label: "Publicada", className: "bg-primary/10 text-primary" },
};

export function StatusBadge({ status }: { status: EvaluationStatus }) {
  const s = STYLES[status];
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${s.className}`}>
      {s.label}
    </span>
  );
}
