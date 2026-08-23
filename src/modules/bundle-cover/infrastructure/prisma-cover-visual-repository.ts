import type { EvaluationBundle as PrismaBundle } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { NotFoundError } from "@/shared/domain/result";
import { DEFAULT_COVER_TEMPLATE_KEY, type CoverTemplateKey } from "../domain/cover-template";
import {
  type CoverVisualProject,
  type CoverVisualRepository,
  type CoverVisualState,
} from "../domain/cover-visual";

/**
 * Fila mínima de la tabla EvaluationBundle que necesitamos para construir
 * el `CoverVisualState` + renderizar. Seleccionamos solo las 6 columnas
 * que esta vista necesita: las 4 de plantilla HTML (para saber el fallback
 * si el visual se restablece) + las 2 nuevas del visual (proyecto + timestamp).
 *
 * NUNCA leemos `coverTemplateBody` para construir el state — solo sus
 * flags. Cargar el body sería tirar a la basura el truco de "state barato".
 */
type BundleVisualRow = Pick<
  PrismaBundle,
  | "id"
  | "institutionId"
  | "coverTemplateKey"
  | "coverTemplateBody"
  | "coverTemplateUpdatedAt"
  | "coverVisualProject"
  | "coverVisualUpdatedAt"
>;

/**
 * Proyecta fila Prisma → estado del dominio del visual.
 *
 * `fallbackKey` y `fallbackSource` se derivan del estado de la plantilla
 * HTML subyacente — son el "¿a qué caería este bundle si restableces el
 * visual?". Si el visual está seteado y el HTML override también, el
 * `fallbackSource` queda en `OVERRIDE` (al restablecer el visual, caería
 * al HTML override, no al built-in). La UI del visual muestra este badge
 * como "Restablecer volvería a tu HTML custom".
 */
function toState(row: BundleVisualRow): CoverVisualState {
  // `coverTemplateKey` siempre viene del dominio (validado en write path)
  // pero la fila Prisma lo expone como `string`. Lo casteamos al brand.
  const fallbackKey: CoverTemplateKey =
    row.coverTemplateKey != null && row.coverTemplateKey.length > 0
      ? (row.coverTemplateKey as CoverTemplateKey)
      : DEFAULT_COVER_TEMPLATE_KEY;
  const hasHtmlOverride = row.coverTemplateBody != null && row.coverTemplateBody.length > 0;
  const hasProject = row.coverVisualProject != null && row.coverVisualProject !== undefined;
  return {
    bundleId: row.id,
    hasProject,
    updatedAt: row.coverVisualUpdatedAt,
    fallbackKey,
    fallbackSource: hasHtmlOverride ? "OVERRIDE" : "BUILT_IN",
  };
}

/**
 * Adaptador Prisma del puerto `CoverVisualRepository` (PR 2 — Cover Visual,
 * ago 2026). Trabaja sobre las columnas `coverVisual*` de `EvaluationBundle`
 * — lee también `coverTemplate*` para construir el `fallbackKey/fallbackSource`
 * del estado (no toca el body en sí).
 *
 * Defensa en profundidad tenant: cada query filtra por `institutionId`.
 * `updateMany` con `count=0` se traduce a `NotFoundError` (no exponemos
 * el "404 vs 403" — siempre 404 cuando el bundle no es de la institución).
 *
 * El proyecto persistido en `coverVisualProject` (JSONB) se mantiene como
 * `unknown` desde el repositorio — la capa de aplicación lo valida con Zod
 * y `MalformedCoverVisualError` antes de confiar en su shape.
 */
export class PrismaCoverVisualRepository implements CoverVisualRepository {
  async loadState(institutionId: string, bundleId: string): Promise<CoverVisualState> {
    const row = await prisma.evaluationBundle.findFirst({
      where: { id: bundleId, institutionId },
      select: {
        id: true,
        institutionId: true,
        coverTemplateKey: true,
        coverTemplateBody: true,
        coverTemplateUpdatedAt: true,
        coverVisualProject: true,
        coverVisualUpdatedAt: true,
      },
    });
    if (!row) {
      throw new NotFoundError("Bundle", bundleId);
    }
    return toState(row);
  }

  async loadProject(institutionId: string, bundleId: string): Promise<CoverVisualProject | null> {
    const row = await prisma.evaluationBundle.findFirst({
      where: { id: bundleId, institutionId },
      select: { coverVisualProject: true },
    });
    if (!row) {
      throw new NotFoundError("Bundle", bundleId);
    }
    // Prisma devuelve `JsonValue` (= `null | string | number | boolean |
    // JsonObject | JsonArray`). Casteamos al alias del dominio sin validar
    // — la validación con Zod es responsabilidad del use case.
    if (row.coverVisualProject == null) return null;
    return row.coverVisualProject as unknown as CoverVisualProject;
  }

  async saveProject(
    institutionId: string,
    bundleId: string,
    project: CoverVisualProject,
  ): Promise<CoverVisualState> {
    const updated = await prisma.evaluationBundle.updateMany({
      where: { id: bundleId, institutionId },
      data: {
        coverVisualProject: project as never, // Prisma JsonValue espera unknown; coverVisualProject es JSONB
        coverVisualUpdatedAt: new Date(),
      },
    });
    if (updated.count === 0) {
      throw new NotFoundError("Bundle", bundleId);
    }
    return this.loadState(institutionId, bundleId);
  }

  async resetProject(institutionId: string, bundleId: string): Promise<CoverVisualState> {
    const updated = await prisma.evaluationBundle.updateMany({
      where: { id: bundleId, institutionId },
      data: {
        // Prisma requiere `Prisma.JsonNull` (no `null` literal) para columnas
        // JSONB porque `null` se interpretaría como "omitir el campo" en
        // updateMany. Ver docs Prisma JSON fields.
        coverVisualProject: Prisma.JsonNull,
        coverVisualUpdatedAt: null,
      },
    });
    if (updated.count === 0) {
      throw new NotFoundError("Bundle", bundleId);
    }
    return this.loadState(institutionId, bundleId);
  }
}
