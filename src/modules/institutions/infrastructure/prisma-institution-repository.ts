import { prisma } from "@/shared/infrastructure/db/prisma";
import type {
  CreateInstitutionData,
  Institution,
  InstitutionRepository,
} from "../domain/institution";

/** Adaptador Prisma del puerto InstitutionRepository. */
export class PrismaInstitutionRepository implements InstitutionRepository {
  async findById(id: string): Promise<Institution | null> {
    return prisma.institution.findUnique({ where: { id } });
  }

  async findBySlug(slug: string): Promise<Institution | null> {
    return prisma.institution.findUnique({ where: { slug } });
  }

  async findByCode(code: string): Promise<Institution | null> {
    return prisma.institution.findUnique({ where: { code } });
  }

  async findAll(): Promise<Institution[]> {
    return prisma.institution.findMany({ orderBy: { name: "asc" } });
  }

  async create(data: CreateInstitutionData): Promise<Institution> {
    return prisma.institution.create({ data });
  }

  async setActive(id: string, isActive: boolean): Promise<void> {
    await prisma.institution.update({ where: { id }, data: { isActive } });
  }
}
