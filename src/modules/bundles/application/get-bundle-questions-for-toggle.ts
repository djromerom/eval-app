import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { NotFoundError, type Result, fail, ok } from "@/shared/domain/result";
import type { BundleStatus } from "../domain/bundle-status";
import type { BundleRepository } from "../domain/bundle";
import type { DisabledBundleQuestionRepository } from "../domain/disabled-bundle-question";

export interface GetBundleQuestionsForToggleInput {
  actor: AuthenticatedUser;
  bundleId: string;
}

/**
 * Vista que el panel de inhabitaciones necesita para renderizar + togglear.
 *
 *   - `hasAnyScanBatch`: lock UI; si true, banner + todos los switches disabled.
 *   - `bundleStatus`: para diagnóstico / breadcrumbs. NO bloquea toggling (la
 *     única regla es por ScanBatch, no por status — PR #1 decidió esto).
 *   - `disabledCount`: cuántas están marcadas no-efectivas (alimenta el badge
 *     del header del panel y el sufijo "N efectivas de M" del ItemsManager).
 *   - `questions`: lista plana en orden estable de impresión
 *     (item.order → section.order → question.number), con `bundlePosition`
 *     1-based global.
 *
 * NO trunca el enunciado: viaja el `statementJson` (TipTap JSON crudo) y la
 * capa de presentación decide cómo convertirlo a texto plano y mostrarlo
 * (preview truncado, full, etc.). Esto evita que el dominio decida sobre UX.
 */
export interface BundleQuestionsForToggle {
  bundleId: string;
  bundleStatus: BundleStatus;
  hasAnyScanBatch: boolean;
  totalQuestions: number;
  disabledCount: number;
  questions: BundleQuestionForToggle[];
}

export interface BundleQuestionForToggle {
  questionId: string;
  bundlePosition: number;
  evaluationOrder: number;
  evaluationTitle: string;
  sectionOrder: number;
  sectionTitle: string | null;
  questionNumber: number;
  statementJson: unknown;
  disabled: boolean;
  disabledAt: Date | null;
  disabledByUserId: string | null;
}

/**
 * Lista las preguntas del cuadernillo en orden de impresión con los datos
 * necesarios para que el panel de inhabitaciones las muestre y togglee.
 *
 * Reglas:
 *   1. Tenant + rol: SUPER_ADMIN o ECU_LIDER.
 *   2. Bundle existe y pertenece a la institución del actor.
 *   3. NO bloquea por `bundle.status` (READY sin escaneos sigue siendo
 *      editable; la única regla de inmutabilidad post-print es por ScanBatch,
 *      enforced por `ToggleDisabledBundleQuestion`). Esta vista es de SOLO
 *      lectura — no muta nada.
 *
 * Hidratación de inhabitaciones: 1 sola query barata a `listActiveByBundle`
 * (indexado por `bundleId`) → Set lookup O(1) por pregunta.
 */
export class GetBundleQuestionsForToggle implements UseCase<
  GetBundleQuestionsForToggleInput,
  BundleQuestionsForToggle
> {
  constructor(
    private readonly bundles: BundleRepository,
    private readonly disabledRepo: DisabledBundleQuestionRepository,
  ) {}

  async execute({
    actor,
    bundleId,
  }: GetBundleQuestionsForToggleInput): Promise<Result<BundleQuestionsForToggle>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    const bundle = await this.bundles.findById(actor.institutionId, bundleId);
    if (!bundle) return fail(new NotFoundError("Cuadernillo", bundleId));

    const [hasAnyScanBatch, rawQuestions, activeDisabled] = await Promise.all([
      this.disabledRepo.bundleHasAnyScanBatch(bundleId),
      this.disabledRepo.listQuestionsForBundle(bundleId),
      this.disabledRepo.listActiveByBundle(bundleId),
    ]);

    if (rawQuestions === null) return fail(new NotFoundError("Cuadernillo", bundleId));

    const activeByQuestionId = new Map(activeDisabled.map((r) => [r.questionId, r] as const));

    const questions: BundleQuestionForToggle[] = rawQuestions.map((q, idx) => {
      const active = activeByQuestionId.get(q.questionId);
      return {
        questionId: q.questionId,
        bundlePosition: idx + 1,
        evaluationOrder: q.evaluationOrder,
        evaluationTitle: q.evaluationTitle,
        sectionOrder: q.sectionOrder,
        sectionTitle: q.sectionTitle,
        questionNumber: q.questionNumber,
        statementJson: q.statementJson,
        disabled: active !== undefined,
        disabledAt: active?.disabledAt ?? null,
        disabledByUserId: active?.disabledByUserId ?? null,
      };
    });

    return ok({
      bundleId,
      bundleStatus: bundle.status,
      hasAnyScanBatch,
      totalQuestions: questions.length,
      disabledCount: questions.filter((q) => q.disabled).length,
      questions,
    });
  }
}
