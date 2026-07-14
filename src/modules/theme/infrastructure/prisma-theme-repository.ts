import { Prisma, type PrismaClient } from "@prisma/client";
import type { EvaluationTheme, InstitutionalTheme } from "../domain/theme";
import { EvaluationThemeSchema, InstitutionalThemeSchema } from "../domain/theme";
import type { ThemeRepository } from "../application/manage-theme";

/**
 * Implementación Prisma del ThemeRepository.
 *
 * La tabla dueña del JSONB es `Institution` (base) y `Evaluation` (override).
 * Guardamos el objeto completo que llega (Prisma acepta `Prisma.InputJsonValue`),
 * y al re-leer lo parseamos con el zod schema del dominio para descartar
 * campos inválidos o tipos esperados.
 */
export class PrismaThemeRepository implements ThemeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async updateInstitutionTheme(
    institutionId: string,
    theme: Partial<InstitutionalTheme>,
  ): Promise<InstitutionalTheme> {
    await this.prisma.institution.update({
      where: { id: institutionId },
      data: { theme: theme as unknown as Prisma.InputJsonValue },
    });
    const fresh = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { theme: true },
    });
    return InstitutionalThemeSchema.parse(fresh?.theme ?? {}) as InstitutionalTheme;
  }

  async updateEvaluationTheme(
    institutionId: string,
    evaluationId: string,
    theme: Partial<EvaluationTheme>,
  ): Promise<EvaluationTheme | null> {
    // empty object = clear override (Prisma.JsonNull = JSONB null, distinto de undefined)
    const data =
      Object.keys(theme).length === 0
        ? { theme: Prisma.JsonNull }
        : { theme: theme as unknown as Prisma.InputJsonValue };
    await this.prisma.evaluation.updateMany({
      where: { id: evaluationId, institutionId },
      data,
    });
    const fresh = await this.prisma.evaluation.findFirst({
      where: { id: evaluationId, institutionId },
      select: { theme: true },
    });
    if (!fresh) return null;
    if (fresh.theme === null || fresh.theme === undefined) return null;
    return EvaluationThemeSchema.parse(fresh.theme) as EvaluationTheme;
  }
}
