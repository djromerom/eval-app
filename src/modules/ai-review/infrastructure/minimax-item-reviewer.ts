/**
 * Implementación del puerto `AiItemReviewer` con MiniMax.
 *
 * Reusa el cliente ya existente (`src/shared/infrastructure/ai`), el mismo
 * que usa el importador de preguntas: mismo modelo (`MINIMAX_MODEL`,
 * `MiniMax-M3` por defecto), misma API compatible con OpenAI.
 */

import { AiClient } from "@/shared/infrastructure/ai/client";

import { AI_REVIEW_SYSTEM_PROMPT, buildReviewUserMessage } from "../application/review-prompt";
import { parseReviewResponse } from "../application/parse-review";
import type { AiItemReviewer, AiReviewInput, AiReviewVerdict } from "../domain/ai-review";

export class MinimaxItemReviewer implements AiItemReviewer {
  constructor(private readonly client: AiClient) {}

  async review(input: AiReviewInput): Promise<AiReviewVerdict> {
    const raw = await this.client.chat({
      system: AI_REVIEW_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildReviewUserMessage(input) }],
      temperature: 0.1,
      maxTokens: 8192,
    });

    const verdict = parseReviewResponse(raw);
    if (!verdict) {
      throw new Error("la respuesta del modelo no es un JSON de revisión válido");
    }
    return verdict;
  }
}
