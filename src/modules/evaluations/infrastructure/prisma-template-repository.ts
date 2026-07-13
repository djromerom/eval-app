import type { Prisma } from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import type {
  CreateTemplateData,
  EvaluationTemplate,
  TemplateRepository,
  TemplateSection,
} from "../domain/evaluation-template";

function toTemplate(row: {
  id: string;
  name: string;
  description: string | null;
  courseSubjectId: string;
  institutionId: string;
  createdBy: string;
  structure: unknown;
  createdAt: Date;
}): EvaluationTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    courseSubjectId: row.courseSubjectId,
    institutionId: row.institutionId,
    createdBy: row.createdBy,
    structure: (row.structure as TemplateSection[]) ?? [],
    createdAt: row.createdAt,
  };
}

export class PrismaTemplateRepository implements TemplateRepository {
  async create(
    institutionId: string,
    createdBy: string,
    data: CreateTemplateData,
  ): Promise<EvaluationTemplate> {
    const row = await prisma.evaluationTemplate.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        courseSubjectId: data.courseSubjectId,
        institutionId,
        createdBy,
        structure: data.structure as unknown as Prisma.InputJsonValue,
      },
    });
    return toTemplate(row);
  }

  async findById(institutionId: string, id: string): Promise<EvaluationTemplate | null> {
    const row = await prisma.evaluationTemplate.findFirst({
      where: { id, institutionId },
    });
    return row ? toTemplate(row) : null;
  }

  async findByInstitution(institutionId: string): Promise<EvaluationTemplate[]> {
    const rows = await prisma.evaluationTemplate.findMany({
      where: { institutionId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toTemplate);
  }

  async delete(institutionId: string, id: string): Promise<void> {
    await prisma.evaluationTemplate.deleteMany({
      where: { id, institutionId },
    });
  }
}
