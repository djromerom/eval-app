/**
 * Implementación Prisma del puerto `EvaluationRuleRepository`.
 *
 * Patrón copiado de `PrismaBookletTypeRepository`:
 * - `findById`/`update`/`delete` filtran por `institutionId` para bloquear
 *   acceso cross-tenant.
 * - `findForEvaluation` resuelve `courseSubjectId → {courseId, subjectId}`
 *   con un join a la tabla CourseSubject; el caller no necesita conocer
 *   esa indirección.
 * - Mapper `toRule(row)` para mantener el dominio libre de tipos Prisma.
 *
 * Notas de la tupla 5-completa:
 * - La unicidad `(institutionId, periodId, courseId, subjectId, bookletTypeId)`
 *   está enforced por un índice único de Postgres. Capturamos P2002 en el
 *   use case para devolver `ConflictError` legible.
 */

import { prisma } from "@/shared/infrastructure/db/prisma";

import type {
  CreateEvaluationRuleData,
  EvaluationRule,
  EvaluationRuleRepository,
  UpdateEvaluationRuleData,
} from "../domain/evaluation-rule";

type Row = {
  id: string;
  institutionId: string;
  periodId: string;
  courseId: string;
  subjectId: string;
  bookletTypeId: string;
  exactQuestions: number;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
};

function toRule(r: Row): EvaluationRule {
  return {
    id: r.id,
    institutionId: r.institutionId,
    periodId: r.periodId,
    courseId: r.courseId,
    subjectId: r.subjectId,
    bookletTypeId: r.bookletTypeId,
    exactQuestions: r.exactQuestions,
    createdById: r.createdById,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export class PrismaEvaluationRuleRepository implements EvaluationRuleRepository {
  async findById(institutionId: string, id: string): Promise<EvaluationRule | null> {
    const row = await prisma.evaluationRule.findFirst({
      where: { id, institutionId },
    });
    return row ? toRule(row) : null;
  }

  async listByPeriod(institutionId: string, periodId: string): Promise<EvaluationRule[]> {
    const rows = await prisma.evaluationRule.findMany({
      where: { institutionId, periodId },
      orderBy: [{ courseId: "asc" }, { subjectId: "asc" }, { bookletTypeId: "asc" }],
    });
    return rows.map(toRule);
  }

  async listByInstitution(institutionId: string): Promise<EvaluationRule[]> {
    const rows = await prisma.evaluationRule.findMany({
      where: { institutionId },
      orderBy: [{ periodId: "asc" }, { courseId: "asc" }, { subjectId: "asc" }],
    });
    return rows.map(toRule);
  }

  async create(institutionId: string, data: CreateEvaluationRuleData): Promise<EvaluationRule> {
    const row = await prisma.evaluationRule.create({
      data: {
        institutionId,
        periodId: data.periodId,
        courseId: data.courseId,
        subjectId: data.subjectId,
        bookletTypeId: data.bookletTypeId,
        exactQuestions: data.exactQuestions,
        createdById: data.createdById,
      },
    });
    return toRule(row);
  }

  async update(
    institutionId: string,
    id: string,
    data: UpdateEvaluationRuleData,
  ): Promise<EvaluationRule | null> {
    const update: { exactQuestions?: number } = {};
    if (data.exactQuestions !== undefined) update.exactQuestions = data.exactQuestions;

    const result = await prisma.evaluationRule.updateMany({
      where: { id, institutionId },
      data: update,
    });
    if (result.count === 0) return null;
    const refreshed = await prisma.evaluationRule.findFirst({
      where: { id, institutionId },
    });
    return refreshed ? toRule(refreshed) : null;
  }

  async delete(institutionId: string, id: string): Promise<void> {
    await prisma.evaluationRule.deleteMany({ where: { id, institutionId } });
  }

  async findForEvaluation(
    institutionId: string,
    courseSubjectId: string,
    periodId: string | null,
    bookletTypeId: string | null,
  ): Promise<EvaluationRule | null> {
    // Sin periodId o sin bookletTypeId explícito no hay enforcement.
    // Reglas y evaluaciones tienen bookletTypeId obligatorio en el modelo,
    // pero evaluations pueden llegar con null por estados legacy; en ese
    // caso no hay match posible (todas las reglas requieren un tipo).
    if (periodId === null || bookletTypeId === null) return null;

    // 1. Resolver courseSubjectId → {courseId, subjectId}. Usamos
    //    `courseSubjectId` (no `id`) porque así bloqueamos cross-tenant:
    //    CourseSubject no lleva institutionId propio, pero pertenece a un
    //    Course que sí lo lleva. El join explícito lo filtra.
    const cs = await prisma.courseSubject.findFirst({
      where: {
        id: courseSubjectId,
        course: { institutionId },
      },
      select: { courseId: true, subjectId: true },
    });
    if (!cs) return null;

    // 2. Buscar la regla matching la tupla completa. El unique constraint
    //    garantiza ≤ 1 fila.
    const row = await prisma.evaluationRule.findFirst({
      where: {
        institutionId,
        periodId,
        courseId: cs.courseId,
        subjectId: cs.subjectId,
        bookletTypeId,
      },
    });
    return row ? toRule(row) : null;
  }
}
