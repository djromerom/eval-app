import type { Prisma, Institution as PrismaInstitution } from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import type {
  CreateInstitutionData,
  Institution,
  InstitutionRepository,
} from "../domain/institution";

/**
 * Proyecta la fila Prisma al shape del dominio: solo los campos del contrato
 * `Institution`, sin filtrar los extra de la tabla (colors, address, phone…)
 * hacia las capas superiores ni la API.
 */
function toInstitution(row: PrismaInstitution): Institution {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    code: row.code,
    logo: row.logo,
    theme: row.theme,
    coverContent: row.coverContent,
    isActive: row.isActive,
    createdAt: row.createdAt,
  };
}

/** Adaptador Prisma del puerto InstitutionRepository. */
export class PrismaInstitutionRepository implements InstitutionRepository {
  async findById(id: string): Promise<Institution | null> {
    const row = await prisma.institution.findUnique({ where: { id } });
    return row && toInstitution(row);
  }

  async findBySlug(slug: string): Promise<Institution | null> {
    const row = await prisma.institution.findUnique({ where: { slug } });
    return row && toInstitution(row);
  }

  async findByCode(code: string): Promise<Institution | null> {
    const row = await prisma.institution.findUnique({ where: { code } });
    return row && toInstitution(row);
  }

  async findAll(): Promise<Institution[]> {
    const rows = await prisma.institution.findMany({ orderBy: { name: "asc" } });
    return rows.map(toInstitution);
  }

  async create(data: CreateInstitutionData): Promise<Institution> {
    return toInstitution(await prisma.institution.create({ data }));
  }

  async setActive(id: string, isActive: boolean): Promise<void> {
    await prisma.institution.update({ where: { id }, data: { isActive } });
  }

  /**
   * Persiste el override institucional de `coverContent`. PR 3 (ago 2026).
   * Acepta `null` para limpiar el override (DB NULL — el merge cae al
   * DEFAULT_*), o un objeto `Partial<...>` para escribir overrides
   * parciales. Si se pasa `undefined` no toca la fila.
   */
  async setCoverContent(
    id: string,
    coverContent: Record<string, unknown> | null,
  ): Promise<void> {
    await prisma.institution.update({
      where: { id },
      data: { coverContent: (coverContent ?? null) as Prisma.InputJsonValue },
    });
  }
}
