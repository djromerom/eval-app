/**
 * Casos de uso para el tema visual.
 *
 * Los temas viven en tablas existentes:
 *   - `Institution.theme` — base institucional (lo edita el ADMIN del colegio)
 *   - `Evaluation.theme` — override por evaluación (lo edita el TEACHER dueño)
 *
 * Para LEER un tema ya resuelto (institucional ⊕ evaluación), basta con
 * extender `GetEvaluation` / `GetMyInstitution` para incluir su `theme`,
 * y luego llamar a `mergeTheme()` en la capa de presentación (print page).
 *
 * Aquí solo están los write cases. El puerto `ThemeRepository` es
 * suficientemente pequeño para que la implementación Prisma simplemente
 * haga `prisma.institution.update` o `prisma.evaluation.update`.
 */
import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import {
  type EvaluationTheme,
  type InstitutionalTheme,
  InstitutionalThemeSchema,
  EvaluationThemeSchema,
} from "../domain/theme";

/**
 * Puerto de persistencia. La implementación hace update sobre
 * `Institution` o `Evaluation` (las tablas dueñas del JSONB).
 */
export interface ThemeRepository {
  updateInstitutionTheme(
    institutionId: string,
    theme: Partial<InstitutionalTheme>,
  ): Promise<InstitutionalTheme>;

  updateEvaluationTheme(
    institutionId: string,
    evaluationId: string,
    theme: Partial<EvaluationTheme>,
  ): Promise<EvaluationTheme | null>;
}

export interface UpdateInstitutionThemeInput {
  actor: AuthenticatedUser;
  theme: Partial<InstitutionalTheme>;
}

export interface UpdateEvaluationThemeInput {
  actor: AuthenticatedUser;
  evaluationId: string;
  /** Si true, limpia el override de la evaluación y vuelve al tema institucional. */
  reset?: boolean;
  theme?: Partial<EvaluationTheme>;
}

export class UpdateInstitutionTheme implements UseCase<
  UpdateInstitutionThemeInput,
  InstitutionalTheme
> {
  constructor(
    private readonly themes: ThemeRepository,
    /** Repositorio de instituciones para verificar que el actor pertenece a ella. */
    private readonly institutions: { findById: (id: string) => Promise<{ id: string } | null> },
  ) {}

  async execute({
    actor,
    theme,
  }: UpdateInstitutionThemeInput): Promise<Result<InstitutionalTheme>> {
    const authorized = requireRole(actor, "ECU_MASTER", "SUPER_ADMIN");
    if (!authorized.ok) return authorized;

    const parsed = InstitutionalThemeSchema.partial().safeParse(theme);
    if (!parsed.success) {
      return fail(
        new ValidationError(
          "Tema inválido: " + parsed.error.issues.map((i) => i.message).join("; "),
        ),
      );
    }

    const inst = await this.institutions.findById(actor.institutionId);
    if (!inst) return fail(new ValidationError("Institución no encontrada."));

    return ok(await this.themes.updateInstitutionTheme(actor.institutionId, parsed.data));
  }
}

export class UpdateEvaluationTheme implements UseCase<
  UpdateEvaluationThemeInput,
  EvaluationTheme | null
> {
  constructor(
    private readonly themes: ThemeRepository,
    /** Repositorio de evaluaciones para verificar ownership y multi-tenancy. */
    private readonly evaluations: {
      getDetail: (
        institutionId: string,
        id: string,
      ) => Promise<{ id: string; teacherId: string; status: string } | null>;
    },
  ) {}

  async execute({
    actor,
    evaluationId,
    reset,
    theme,
  }: UpdateEvaluationThemeInput): Promise<Result<EvaluationTheme | null>> {
    const authorized = requireRole(actor, "TEACHER", "COORDINATOR");
    if (!authorized.ok) return authorized;

    const evalRow = await this.evaluations.getDetail(actor.institutionId, evaluationId);
    if (!evalRow) return fail(new ValidationError("Evaluación no encontrada."));
    if (evalRow.teacherId !== actor.userId && !actor.roles.includes("COORDINATOR")) {
      return fail(new ValidationError("Solo el docente dueño puede editar el tema."));
    }
    if (evalRow.status !== "DRAFT") {
      return fail(
        new ValidationError(
          "El tema de la evaluación solo se puede editar mientras está en borrador.",
        ),
      );
    }

    if (reset) {
      return ok(await this.themes.updateEvaluationTheme(actor.institutionId, evaluationId, {}));
    }

    const parsed = EvaluationThemeSchema.partial().safeParse(theme ?? {});
    if (!parsed.success) {
      return fail(
        new ValidationError(
          "Tema inválido: " + parsed.error.issues.map((i) => i.message).join("; "),
        ),
      );
    }

    return ok(
      await this.themes.updateEvaluationTheme(actor.institutionId, evaluationId, parsed.data),
    );
  }
}
