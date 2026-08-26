/**
 * Adaptador Prisma del puerto `CoverLiveRepository` (ago 2026).
 *
 * Trabaja sobre las columnas `coverLiveProject` + `coverLiveUpdatedAt` de
 * `EvaluationBundle`. Lee también `coverTemplate*` para construir el
 * `fallbackKey/fallbackSource` del estado.
 *
 * Defensa en profundidad tenant: cada query filtra por `institutionId`.
 * `updateMany` con `count=0` se traduce a `NotFoundError` (no exponemos
 * el "404 vs 403" — siempre 404 cuando el bundle no es de la institución).
 *
 * El proyecto persistido en `coverLiveProject` (JSONB) se mantiene como
 * `Prisma.JsonValue` desde el repositorio — la capa de aplicación lo
 * valida con Zod y `MalformedCoverLiveError` antes de confiar en su shape.
 */

import type { EvaluationBundle as PrismaBundle } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { NotFoundError } from "@/shared/domain/result";
import {
  DEFAULT_COVER_TEMPLATE_KEY,
  type CoverTemplateKey,
} from "@/modules/bundle-cover/domain/cover-template";
import {
  type CoverLiveProject,
  type CoverLiveRepository,
  type CoverLiveState,
} from "../domain/cover-html";

/**
 * Fila mínima de la tabla EvaluationBundle que necesitamos para construir
 * el `CoverLiveState`. Seleccionamos solo las 6 columnas que esta vista
 * necesita: las 4 de plantilla HTML (para el fallback si el live se
 * restablece) + las 2 nuevas del live (proyecto + timestamp).
 */
type BundleLiveRow = Pick<
  PrismaBundle,
  | "id"
  | "institutionId"
  | "coverTemplateKey"
  | "coverTemplateBody"
  | "coverTemplateUpdatedAt"
  | "coverLiveProject"
  | "coverLiveUpdatedAt"
>;

/**
 * Proyecta fila Prisma → estado del dominio del live.
 *
 * `fallbackKey` y `fallbackSource` se derivan del estado de la plantilla
 * HTML subyacente — son el "¿a qué caería este bundle si restableces el
 * live?". Si el live está seteado y el HTML override también, el
 * `fallbackSource` queda en `OVERRIDE`.
 *
 * NO consulta ninguna columna "visual" — el live es la fuente de mayor
 * precedencia que esta vista conoce. La UI puede refrescar el state con
 * `loadState` después de un reset para ver el cascade real.
 */
function toState(row: BundleLiveRow): CoverLiveState {
  const fallbackKey: CoverTemplateKey =
    row.coverTemplateKey != null && row.coverTemplateKey.length > 0
      ? (row.coverTemplateKey as CoverTemplateKey)
      : DEFAULT_COVER_TEMPLATE_KEY;
  const hasHtmlOverride = row.coverTemplateBody != null && row.coverTemplateBody.length > 0;
  const hasProject = row.coverLiveProject != null && row.coverLiveProject !== undefined;
  return {
    bundleId: row.id,
    hasProject,
    updatedAt: row.coverLiveUpdatedAt,
    fallbackKey,
    fallbackSource: hasHtmlOverride ? "OVERRIDE" : "BUILT_IN",
  };
}

export class PrismaCoverLiveRepository implements CoverLiveRepository {
  async loadState(institutionId: string, bundleId: string): Promise<CoverLiveState> {
    const row = await prisma.evaluationBundle.findFirst({
      where: { id: bundleId, institutionId },
      select: {
        id: true,
        institutionId: true,
        coverTemplateKey: true,
        coverTemplateBody: true,
        coverTemplateUpdatedAt: true,
        coverLiveProject: true,
        coverLiveUpdatedAt: true,
      },
    });
    if (!row) {
      throw new NotFoundError("Bundle", bundleId);
    }
    return toState(row);
  }

  async loadProject(institutionId: string, bundleId: string): Promise<CoverLiveProject | null> {
    const row = await prisma.evaluationBundle.findFirst({
      where: { id: bundleId, institutionId },
      select: { coverLiveProject: true },
    });
    if (!row) {
      throw new NotFoundError("Bundle", bundleId);
    }
    if (row.coverLiveProject == null) return null;
    return row.coverLiveProject as unknown as CoverLiveProject;
  }

  async saveProject(
    institutionId: string,
    bundleId: string,
    project: CoverLiveProject,
  ): Promise<CoverLiveState> {
    const updated = await prisma.evaluationBundle.updateMany({
      where: { id: bundleId, institutionId },
      data: {
        coverLiveProject: project as never,
        coverLiveUpdatedAt: new Date(),
      },
    });
    if (updated.count === 0) {
      throw new NotFoundError("Bundle", bundleId);
    }
    return this.loadState(institutionId, bundleId);
  }

  async resetProject(institutionId: string, bundleId: string): Promise<CoverLiveState> {
    const updated = await prisma.evaluationBundle.updateMany({
      where: { id: bundleId, institutionId },
      data: {
        // Prisma requiere `Prisma.JsonNull` (no `null` literal) para columnas
        // JSONB porque `null` se interpretaría como "omitir el campo" en
        // updateMany. Ver docs Prisma JSON fields.
        coverLiveProject: Prisma.JsonNull,
        coverLiveUpdatedAt: null,
      },
    });
    if (updated.count === 0) {
      throw new NotFoundError("Bundle", bundleId);
    }
    return this.loadState(institutionId, bundleId);
  }
}
