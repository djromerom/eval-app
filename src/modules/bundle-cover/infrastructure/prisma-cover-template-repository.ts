import type { EvaluationBundle as PrismaBundle } from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { NotFoundError } from "@/shared/domain/result";
import {
  DEFAULT_COVER_TEMPLATE_KEY,
  type CoverTemplateKey,
  type CoverTemplateRepository,
  type CoverTemplateSource,
  type CoverTemplateState,
  toCoverTemplateKey,
} from "../domain/cover-template";

/**
 * Fila mínima de la tabla EvaluationBundle que necesitamos para construir el
 * CoverTemplateState. Seleccionamos solo las 4 columnas de cover para evitar
 * arrastrar joins / datos del bundle por la red cuando solo queremos el
 * estado del cover.
 */
type BundleCoverRow = Pick<
  PrismaBundle,
  "id" | "institutionId" | "coverTemplateKey" | "coverTemplateBody" | "coverTemplateUpdatedAt"
>;

/** Proyecta fila Prisma → estado del dominio. */
function toState(row: BundleCoverRow): CoverTemplateState {
  const rawKey = row.coverTemplateKey;
  // Si la BD tiene una key válida (cumple regex) la casteamos; si no (dato
  // legacy o corrupto), caemos a la default. No propagamos la invalidez
  // hacia arriba porque el dominio ya garantizó el shape al escribir.
  const key: CoverTemplateKey = rawKey ? toCoverTemplateKey(rawKey) : DEFAULT_COVER_TEMPLATE_KEY;
  const hasOverride = row.coverTemplateBody != null && row.coverTemplateBody.length > 0;
  const source: CoverTemplateSource = hasOverride ? "OVERRIDE" : "BUILT_IN";
  return {
    bundleId: row.id,
    key,
    source,
    hasOverride,
    updatedAt: row.coverTemplateUpdatedAt,
  };
}

/**
 * Adaptador Prisma del puerto `CoverTemplateRepository`. Trabaja SOLO sobre
 * las 4 columnas `coverTemplate*` de `EvaluationBundle` — nunca toca el
 * resto de la fila. Esto facilita cachear / invalidar de forma quirúrgica
 * sin arrastrar joins.
 *
 * Cada método verifica primero que el bundle pertenezca a la institución
 * (filtro `institutionId` en el WHERE) para mantener el aislamiento tenant
 * sin necesidad de un read previo.
 */
export class PrismaCoverTemplateRepository implements CoverTemplateRepository {
  async loadState(institutionId: string, bundleId: string): Promise<CoverTemplateState> {
    const row = await prisma.evaluationBundle.findFirst({
      where: { id: bundleId, institutionId },
      select: {
        id: true,
        institutionId: true,
        coverTemplateKey: true,
        coverTemplateBody: true,
        coverTemplateUpdatedAt: true,
      },
    });
    if (!row) {
      throw new NotFoundError("Bundle", bundleId);
    }
    return toState(row);
  }

  async loadBody(institutionId: string, bundleId: string): Promise<string | null> {
    const row = await prisma.evaluationBundle.findFirst({
      where: { id: bundleId, institutionId },
      select: { coverTemplateBody: true },
    });
    if (!row) {
      throw new NotFoundError("Bundle", bundleId);
    }
    return row.coverTemplateBody;
  }

  async saveOverride(
    institutionId: string,
    bundleId: string,
    body: string,
  ): Promise<CoverTemplateState> {
    // Aseguramos que existe y pertenece a la institución antes de escribir;
    // updateMany devuelve count=0 si no encuentra, lo que detectamos abajo.
    const updated = await prisma.evaluationBundle.updateMany({
      where: { id: bundleId, institutionId },
      data: {
        coverTemplateBody: body,
        coverTemplateUpdatedAt: new Date(),
      },
    });
    if (updated.count === 0) {
      throw new NotFoundError("Bundle", bundleId);
    }
    return this.loadState(institutionId, bundleId);
  }

  async resetOverride(institutionId: string, bundleId: string): Promise<CoverTemplateState> {
    const updated = await prisma.evaluationBundle.updateMany({
      where: { id: bundleId, institutionId },
      data: {
        coverTemplateBody: null,
        coverTemplateUpdatedAt: null,
      },
    });
    if (updated.count === 0) {
      throw new NotFoundError("Bundle", bundleId);
    }
    return this.loadState(institutionId, bundleId);
  }

  async setKey(
    institutionId: string,
    bundleId: string,
    key: CoverTemplateKey | null,
  ): Promise<CoverTemplateState> {
    // Al cambiar la key NO tocamos el body — si el bundle tenía un override
    // previo, ese override queda vivo pero ahora bajo la nueva key. Útil si
    // el usuario quiere "clonar" su edición a otra variante; confuso si
    // cambia accidentalmente. El use case decide si resetear primero.
    const updated = await prisma.evaluationBundle.updateMany({
      where: { id: bundleId, institutionId },
      data: { coverTemplateKey: key },
    });
    if (updated.count === 0) {
      throw new NotFoundError("Bundle", bundleId);
    }
    return this.loadState(institutionId, bundleId);
  }
}
