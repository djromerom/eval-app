/**
 * Helper de lectura: dado (institutionId, evaluationId), devuelve el tema
 * ya colapsado (institucional ⊕ override de formulación) listo para aplicar.
 *
 * La ruta de print NO usa use cases para esto — son más pesados y no
 * necesitamos chequeos de rol (el actor ya pasó por resolvePrintActor antes).
 * Leer el JSONB directo con Prisma es la opción correcta aquí.
 *
 * Si en el futuro la lectura se vuelve compleja (cache, invalidación por
 * update, etc.), promover a use case.
 */
import { prisma } from "@/shared/infrastructure/db/prisma";
import {
  type ResolvedTheme,
  parseEvaluationTheme,
  parseInstitutionalTheme,
  mergeTheme,
} from "../domain/theme";

export async function getResolvedTheme(
  institutionId: string,
  evaluationId: string,
): Promise<ResolvedTheme> {
  const [inst, ev] = await Promise.all([
    prisma.institution.findUnique({
      where: { id: institutionId },
      select: { theme: true },
    }),
    prisma.evaluation.findFirst({
      where: { id: evaluationId, institutionId },
      select: { theme: true },
    }),
  ]);
  return mergeTheme(parseInstitutionalTheme(inst?.theme), parseEvaluationTheme(ev?.theme));
}
