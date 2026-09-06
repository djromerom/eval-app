/**
 * Implementación Prisma del puerto `BookletTypeRepository`.
 *
 * Patrón copiado de `PrismaPeriodRepository` (en
 * `prisma-academic-repositories.ts`):
 * - `findById` usa `findFirst` con filtro `institutionId` (bloquea
 *   acceso cross-tenant incluso si el `id` existe en otra institución).
 * - `update` usa spread condicional para updates parciales.
 * - Mapper `toBookletType(row)` para mantener el dominio libre de tipos
 *   de Prisma.
 */

import { prisma } from "@/shared/infrastructure/db/prisma";

import type {
  BookletType,
  BookletTypeRepository,
  CreateBookletTypeData,
  UpdateBookletTypeData,
} from "../domain/booklet-type";

type Row = {
  id: string;
  name: string;
  description: string | null;
  periodId: string;
  institutionId: string;
  order: number;
};

function toBookletType(r: Row): BookletType {
  return {
    id: r.id,
    institutionId: r.institutionId,
    periodId: r.periodId,
    name: r.name,
    description: r.description,
    order: r.order,
  };
}

export class PrismaBookletTypeRepository implements BookletTypeRepository {
  async findById(institutionId: string, id: string): Promise<BookletType | null> {
    const row = await prisma.bookletType.findFirst({
      where: { id, institutionId },
    });
    return row ? toBookletType(row) : null;
  }

  async listByPeriod(institutionId: string, periodId: string): Promise<BookletType[]> {
    const rows = await prisma.bookletType.findMany({
      where: { institutionId, periodId },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });
    return rows.map(toBookletType);
  }

  async listByInstitution(institutionId: string): Promise<BookletType[]> {
    const rows = await prisma.bookletType.findMany({
      where: { institutionId },
      orderBy: [{ periodId: "asc" }, { order: "asc" }, { createdAt: "asc" }],
    });
    return rows.map(toBookletType);
  }

  async findByName(institutionId: string, name: string): Promise<BookletType[]> {
    const trimmed = name.trim();
    if (!trimmed) return [];
    // Match case-insensitive: la BD guarda "Estándar", el Excel puede traer
    // "ESTANDAR". Postgres LIKE con ILIKE no es portable; usamos `mode:
    // "insensitive"` de Prisma.
    const rows = await prisma.bookletType.findMany({
      where: { institutionId, name: { equals: trimmed, mode: "insensitive" } },
      orderBy: [{ periodId: "asc" }, { order: "asc" }],
    });
    return rows.map(toBookletType);
  }

  async create(institutionId: string, data: CreateBookletTypeData): Promise<BookletType> {
    const order =
      data.order ??
      (await prisma.bookletType.count({
        where: { institutionId, periodId: data.periodId },
      }));
    const row = await prisma.bookletType.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        periodId: data.periodId,
        institutionId,
        order,
      },
    });
    return toBookletType(row);
  }

  async update(
    institutionId: string,
    id: string,
    data: UpdateBookletTypeData,
  ): Promise<BookletType | null> {
    // Solo aplicar campos definidos en `data`. Spread condicional.
    const update: {
      name?: string;
      description?: string | null;
      order?: number;
    } = {};
    if (data.name !== undefined) update.name = data.name;
    if (data.description !== undefined) update.description = data.description;
    if (data.order !== undefined) update.order = data.order;

    const row = await prisma.bookletType.updateMany({
      where: { id, institutionId },
      data: update,
    });
    if (row.count === 0) return null;
    const refreshed = await prisma.bookletType.findFirst({
      where: { id, institutionId },
    });
    return refreshed ? toBookletType(refreshed) : null;
  }

  async delete(institutionId: string, id: string): Promise<void> {
    await prisma.bookletType.deleteMany({ where: { id, institutionId } });
  }
}
