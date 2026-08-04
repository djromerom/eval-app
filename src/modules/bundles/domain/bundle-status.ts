/**
 * Máquina de estados del Bundle. Mismo modelo mental que
 * Evaluation.DRAFT → PUBLISHED, pero simplificado a 2 estados
 * en Sprint 1. Ver docs/cuadernillos.md §"Estado y workflow".
 */

export type BundleStatus = "DRAFT" | "READY";

interface Transition {
  from: BundleStatus;
  to: BundleStatus;
}

const TRANSITIONS: Transition[] = [
  { from: "DRAFT", to: "READY" },
  // Unmark (READY → DRAFT) está permitido en Sprint 3 solo para SUPER_ADMIN.
  // Lo dejamos en TRANSITIONS para uso futuro pero las use cases actuales
  // no lo exponen.
  { from: "READY", to: "DRAFT" },
];

export function findTransition(from: BundleStatus, to: BundleStatus): Transition | null {
  return TRANSITIONS.find((t) => t.from === from && t.to === to) ?? null;
}

/** True si la transición está permitida (sin chequear permisos de rol). */
export function canTransition(from: BundleStatus, to: BundleStatus): boolean {
  return findTransition(from, to) !== null;
}

/** True si el contenido del bundle es inmutable (no se puede editar). */
export function isLocked(status: BundleStatus): boolean {
  return status === "READY";
}
