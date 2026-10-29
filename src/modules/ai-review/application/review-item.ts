/**
 * Caso de uso: revisar un ítem con IA.
 *
 * Recibe el contenido del ítem YA en texto plano (lo arma la capa de
 * presentación, que es quien sabe leer el TipTap del formulario) y lo
 * devuelve al proveedor a través del puerto `AiItemReviewer`.
 *
 * Patrón idéntico al resto de la capa `application` del proyecto:
 * - `UseCase<Input, Output>` con `execute(input)`.
 * - `Result<T>` para errores legibles (nunca throw).
 * - El actor se recibe explícitamente y se valida el rol.
 */

import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { DomainError, type Result, fail, ok } from "@/shared/domain/result";

import { enforceKeyConsistency } from "./enforce-key";
import type { AiItemReviewer, AiReviewInput, AiReviewVerdict } from "../domain/ai-review";

export interface ReviewItemInput {
  actor: AuthenticatedUser;
  /** Contenido del ítem en texto plano. */
  item: AiReviewInput;
}

export class ReviewItem implements UseCase<ReviewItemInput, AiReviewVerdict> {
  constructor(private readonly reviewer: AiItemReviewer) {}

  async execute({ actor, item }: ReviewItemInput): Promise<Result<AiReviewVerdict>> {
    const authorized = requireRole(actor, "TEACHER", "ECU_LIDER", "ECU_MASTER");
    if (!authorized.ok) return authorized;

    try {
      const verdict = await this.reviewer.review(item);
      // La clave que resolvió la IA tiene que coincidir con la del docente:
      // si no, el ítem no pasa (ver `enforce-key.ts`).
      return ok(enforceKeyConsistency(verdict, item));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[ai-review] falló la revisión con IA: ${message}`);
      return fail(new DomainError("AI_REVIEW_FAILED", "No se pudo completar la revisión con IA."));
    }
  }
}
