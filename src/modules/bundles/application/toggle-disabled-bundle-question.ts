import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { NotFoundError, type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import {
  type DisabledBundleQuestion,
  assertDejaAlMenosUnaEfectiva,
  type DisabledBundleQuestionRepository,
} from "../domain/disabled-bundle-question";
import { type BundleRepository } from "../domain/bundle";

export interface ToggleDisabledBundleQuestionInput {
  actor: AuthenticatedUser;
  bundleId: string;
  questionId: string;
  /** `true` = inhabitar; `false` = re-habilitar. */
  disabled: boolean;
}

/**
 * Inhabilita o re-habilita una pregunta dentro de un Cuadernillo. La pregunta
 * deja (o vuelve a) contar para la calificación del cuadernillo.
 *
 * Reglas validadas (todas en orden, cada una con código estable para la UI):
 *   1. Tenant + rol: SUPER_ADMIN o ECU_LIDER (no TEACHER: esta feature la
 *      dispara el editor del cuadernillo, que es vista de líder/admin).
 *   2. Bundle existe y pertenece a la institución del actor.
 *   3. Lock pre-scan: si ya hay algún ScanBatch apuntando al bundle, NO se
 *      puede togglear. Decisión deliberada sep 2026: NO re-procesamos hojas
 *      viejas. La operación queda "congelada" hasta que se cree un nuevo
 *      cuadernillo.
 *   4. La pregunta pertenece al bundle (question → evaluation ∈ bundle.items).
 *   5. ≥1 pregunta efectiva queda después del toggle (UX: el docente no puede
 *      inhabitarlas todas; un cuadernillo con 0 efectivas no califica).
 *
 * Idempotente: togglear al estado actual no es un error.
 */
export class ToggleDisabledBundleQuestion implements UseCase<
  ToggleDisabledBundleQuestionInput,
  DisabledBundleQuestion
> {
  constructor(
    private readonly bundles: BundleRepository,
    private readonly disabledRepo: DisabledBundleQuestionRepository,
  ) {}

  async execute({
    actor,
    bundleId,
    questionId,
    disabled,
  }: ToggleDisabledBundleQuestionInput): Promise<Result<DisabledBundleQuestion>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    const bundle = await this.bundles.findById(actor.institutionId, bundleId);
    if (!bundle) return fail(new NotFoundError("Cuadernillo", bundleId));

    // (3) Lock pre-scan. Esta es la decisión más delicada — la razón de ser
    // de toda la feature. Si el docente quiere inhabitaciones que apliquen a
    // hojas ya escaneadas, la vía correcta es crear un nuevo cuadernillo.
    if (await this.disabledRepo.bundleHasAnyScanBatch(bundleId)) {
      return fail(
        new ValidationError(
          "Ya hay hojas escaneadas de este cuadernillo. Las inhabitaciones no se pueden modificar; crea un cuadernillo nuevo si necesitas excluir preguntas.",
        ),
      );
    }

    // (4) La pregunta pertenece al bundle.
    const preguntas = await this.disabledRepo.listAllQuestionIdsForBundle(bundleId);
    if (preguntas === null) return fail(new NotFoundError("Cuadernillo", bundleId));
    if (!preguntas.includes(questionId)) {
      return fail(new ValidationError("La pregunta no pertenece a este cuadernillo."));
    }

    // (5) Después de este toggle queda ≥1 efectiva.
    const activas = await this.disabledRepo.listActiveByBundle(bundleId);
    const idsActivos = new Set(activas.map((r) => r.questionId));
    const guard = assertDejaAlMenosUnaEfectiva({
      totalPreguntasBundle: preguntas.length,
      idsYaInhabilitados: idsActivos,
      intentaInhabilitar: disabled,
      questionId,
    });
    if (!guard.ok) {
      return fail(
        new ValidationError(
          "No puedes inhabitarlas todas: el cuadernillo debe tener al menos una pregunta efectiva para poder calificar.",
        ),
      );
    }

    const row = await this.disabledRepo.setDisabled({
      bundleId,
      questionId,
      disabled,
      actorUserId: actor.userId,
    });
    return ok(row);
  }
}
