import type { Role } from "@/shared/application/authenticated-user";

/**
 * Flujo de aprobación (REQUERIMIENTOS_v2.md §3.3):
 * DRAFT → IN_REVIEW → APPROVED → PUBLISHED
 * Rechazo o edición posterior regresan a DRAFT.
 * Cada aprobación crea una nueva versión inmutable.
 */
export type EvaluationStatus = "DRAFT" | "IN_REVIEW" | "APPROVED" | "PUBLISHED";

export interface StatusTransition {
  from: EvaluationStatus;
  to: EvaluationStatus;
  allowedRoles: Role[];
  /** El rechazo (IN_REVIEW → DRAFT) exige comentarios obligatorios */
  requiresComment: boolean;
}

const TRANSITIONS: StatusTransition[] = [
  {
    from: "DRAFT",
    to: "IN_REVIEW",
    allowedRoles: ["TEACHER", "COORDINATOR"],
    requiresComment: false,
  },
  { from: "IN_REVIEW", to: "APPROVED", allowedRoles: ["COORDINATOR"], requiresComment: false },
  { from: "IN_REVIEW", to: "DRAFT", allowedRoles: ["COORDINATOR"], requiresComment: true },
  {
    from: "APPROVED",
    to: "PUBLISHED",
    allowedRoles: ["COORDINATOR", "TEACHER"],
    requiresComment: false,
  },
  // Editar una formulación publicada la regresa a borrador y notifica al coordinador
  { from: "PUBLISHED", to: "DRAFT", allowedRoles: ["TEACHER"], requiresComment: false },
];

export function findTransition(
  from: EvaluationStatus,
  to: EvaluationStatus,
): StatusTransition | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}

export function canTransition(
  from: EvaluationStatus,
  to: EvaluationStatus,
  roles: Role[],
): boolean {
  const transition = findTransition(from, to);
  if (!transition) return false;
  return transition.allowedRoles.some((r) => roles.includes(r));
}

/** Solo las formulaciones publicadas se pueden imprimir. */
export function isPrintable(status: EvaluationStatus): boolean {
  return status === "PUBLISHED";
}
