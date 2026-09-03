/**
 * Badge del items-badge-cell: "X / Y" donde X = total real de la formulación
 * y Y = `EvaluationRule.exactQuestions` esperado por la tupla
 * (Prueba × Grado × Asignatura × Tipo de cuadernillo).
 *
 * Cuatro casos canónicos (no hay reglas raras; el docente lo aprobó así):
 *
 *   | total | expected | badge   | color     |
 *   |-------|----------|---------|-----------|
 *   | X     | Y        | "ok"    | success   |
 *   | < Y   | Y        | "low"   | warning   |
 *   | > Y   | Y        | "high"  | destructive |
 *   | X     | null     | "none"  | muted (sin regla configurada) |
 *
 * Función pura: tested sin BD.
 */
export type ItemsBadge = "ok" | "low" | "high" | "none";

export function computeItemsBadge(total: number, expected: number | null): ItemsBadge {
  if (expected == null) return "none";
  if (total === expected) return "ok";
  if (total < expected) return "low";
  return "high";
}
