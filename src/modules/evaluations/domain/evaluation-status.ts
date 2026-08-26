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
    allowedRoles: ["TEACHER", "ECU_LIDER"],
    requiresComment: false,
  },
  // ATAJO de "Publicar con un click" desde el editor unificado (ago 2026).
  // El flujo canónico sigue siendo DRAFT → IN_REVIEW → APPROVED → PUBLISHED,
  // pero para esta versión se permite saltar directamente a PUBLISHED.
  // Mismos roles permitidos que la transición por APPROVED (COORDINATOR +
  // TEACHER dueño — el check de "dueño" lo agrega el use case).
  {
    from: "DRAFT",
    to: "PUBLISHED",
    allowedRoles: ["TEACHER", "ECU_LIDER"],
    requiresComment: false,
  },
  { from: "IN_REVIEW", to: "APPROVED", allowedRoles: ["ECU_LIDER"], requiresComment: false },
  { from: "IN_REVIEW", to: "DRAFT", allowedRoles: ["ECU_LIDER"], requiresComment: true },
  {
    from: "APPROVED",
    to: "PUBLISHED",
    allowedRoles: ["ECU_LIDER", "TEACHER"],
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
