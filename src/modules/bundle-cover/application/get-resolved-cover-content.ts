/**
 * Helper de lectura: dado (institutionId, bundleId), devuelve el contenido
 * textual de la portada YA colapsado (institucional ⊕ override de compendio)
 * listo para pasárselo a `assembleContext()`.
 *
 * Espejo de `getResolvedBundleTheme()` en `src/modules/theme/application/
 * get-resolved-bundle-theme.ts`. Lee directo de Prisma (no de los repos)
 * porque los overrides son JSONB y el caso de uso es siempre de lectura —
 * los use cases que necesitan transacción o lógica de dominio pasan por
 * el repo correspondiente.
 *
 * Precedencia (de mayor a menor):
 *   1. `EvaluationBundle.coverContent`  → override del compendio
 *   2. `Institution.coverContent`       → override institucional
 *   3. `DEFAULT_*` exportado por `./cover-defaults.ts`
 *
 * Si la institución o el compendio no tienen la columna seteada (null),
 * `parseCoverContent()` devuelve `{}` y `mergeCoverContent()` rellena
 * con defaults. Garantiza que el PDF sale aunque la BD esté vacía.
 */
import { prisma } from "@/shared/infrastructure/db/prisma";
import {
  mergeCoverContent,
  parseCoverContent,
  type ResolvedCoverContent,
} from "../domain/cover-content";

export async function getResolvedCoverContent(
  institutionId: string,
  bundleId: string,
): Promise<ResolvedCoverContent> {
  const [inst, bundle] = await Promise.all([
    prisma.institution.findUnique({
      where: { id: institutionId },
      select: { coverContent: true },
    }),
    prisma.evaluationBundle.findFirst({
      where: { id: bundleId, institutionId },
      select: { coverContent: true },
    }),
  ]);
  // mergeCoverContent(institutional, bundle) → el segundo arg tiene
  // precedencia (override del compendio).
  return mergeCoverContent(
    parseCoverContent(inst?.coverContent),
    parseCoverContent(bundle?.coverContent),
  );
}
