import type { Institution as PrismaInstitution } from "@prisma/client";
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
}
