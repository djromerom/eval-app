import { prisma } from "@/shared/infrastructure/db/prisma";
import { PrismaInstitutionRepository } from "@/modules/institutions/infrastructure/prisma-institution-repository";
import { UpdateEvaluationTheme, UpdateInstitutionTheme } from "../application/manage-theme";
import { PrismaThemeRepository } from "./prisma-theme-repository";

/**
 * Composition root del módulo theme.
 *
 * La print page NO usa estos use cases (lee el tema desde
 * `makeGetEvaluation` / `makeGetMyInstitution` y llama a `mergeTheme()`
 * directamente). Estos casos solo se usan para ESCRIBIR el tema desde
 * la UI admin/teacher.
 */
const themeRepo = new PrismaThemeRepository(prisma);
const institutionRepo = new PrismaInstitutionRepository();

export const makeUpdateInstitutionTheme = () =>
  new UpdateInstitutionTheme(themeRepo, {
    // Adaptador mínimo: solo necesitamos `findById` para verificar
    // que la institución del actor existe (debería siempre existir, pero
    // la validación es defensa en profundidad).
    findById: (id: string) => institutionRepo.findById(id),
  });

export const makeUpdateEvaluationTheme = () =>
  new UpdateEvaluationTheme(themeRepo, {
    // Adaptador al EvaluationRepository — usamos `getDetail` directamente.
    // Importamos lazy para no introducir ciclo de módulos.
    getDetail: async (institutionId: string, id: string) => {
      const { PrismaEvaluationRepository } =
        await import("@/modules/evaluations/infrastructure/prisma-evaluation-repository");
      const repo = new PrismaEvaluationRepository();
      return repo.getDetail(institutionId, id);
    },
  });
