import { AiClient } from "@/shared/infrastructure/ai/client";
import { loadAiConfig } from "@/shared/infrastructure/ai/config";

import { ReviewItem } from "../application/review-item";
import { MinimaxItemReviewer } from "./minimax-item-reviewer";

/**
 * Composition root del módulo ai-review.
 *
 * `makeReviewItem()` devuelve `null` cuando no hay `MINIMAX_API_KEY`
 * configurada: en ese caso no hay revisión posible y el flujo de guardado
 * sigue su curso normal (el docente nunca queda trabado por la IA).
 */
export function makeReviewItem(): ReviewItem | null {
  const config = loadAiConfig();
  if (!config) return null;
  return new ReviewItem(new MinimaxItemReviewer(new AiClient(config)));
}
