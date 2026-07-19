/**
 * Helper de lectura: dado (institutionId, bundleId), devuelve el tema
 * ya colapsado (institucional ⊕ override de compendio) listo para aplicar.
 *
 * Espejo de `getResolvedTheme()` para evaluaciones, pero aplicando el
 * override del compendio en vez del de la primera evaluación. Necesario
 * porque el `getResolvedTheme()` legacy resolvía contra el `evaluationId`
 * de la primera evaluación del bundle — ignorando cualquier cambio que el
 * admin hiciera en el editor de tema del compendio (que es lo que
 * SÍ queremos respetar para que el cuadernillo del PDF final use el look
 * diseñado).
 *
 * La ruta de print NO usa use cases para esto — son más pesados y no
 * necesitamos chequeos de rol (el actor ya pasó por resolvePrintActor antes).
 * Leer el JSONB directo con Prisma es la opción correcta aquí.
 *
 * Precedencia (orden de mayor a menor):
 *   1. `bundle.theme`     → override del compendio
 *   2. `institution.theme` → override institucional
 *   3. `INSTITUTIONAL_DEFAULT`
 */
import { prisma } from "@/shared/infrastructure/db/prisma";
import {
  type ResolvedTheme,
  parseEvaluationTheme,
  parseInstitutionalTheme,
  mergeTheme,
} from "../domain/theme";

export async function getResolvedBundleTheme(
  institutionId: string,
  bundleId: string,
): Promise<ResolvedTheme> {
  const [inst, bundle] = await Promise.all([
    prisma.institution.findUnique({
      where: { id: institutionId },
      select: { theme: true },
    }),
    prisma.evaluationBundle.findFirst({
      where: { id: bundleId, institutionId },
      select: { theme: true },
    }),
  ]);
  // mergeTheme(institutional, evaluation) → el segundo arg tiene precedencia.
  // Aquí el segundo arg es el override del bundle.
  return mergeTheme(parseInstitutionalTheme(inst?.theme), parseEvaluationTheme(bundle?.theme));
}
