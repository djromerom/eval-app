/**
 * Implementación Prisma del puerto `OptionRuleRepository` y del
 * `OptionRuleResolver`.
 *
 * Patrón copiado de `PrismaEvaluationRuleRepository`:
 * - `findById`/`update`/`delete` filtran por `institutionId` para bloquear
 *   acceso cross-tenant.
 * - `findForCourseSubject` resuelve `courseSubjectId → subjectId` con un
 *   join a la tabla CourseSubject; el caller no necesita conocer esa
 *   indirección.
 * - Mapper `toRule(row)` para mantener el dominio libre de tipos Prisma.
 *
 * La unicidad `(institutionId, periodId, subjectId)` está enforced por un
 * índice único de Postgres. Capturamos P2002 en el use case para devolver
 * `ConflictError` legible.
 */

import { prisma } from "@/shared/infrastructure/db/prisma";

import {
  DEFAULT_OPTIONS_RANGE,
  type CreateOptionRuleData,
  type OptionRule,
  type OptionRuleRepository,
  type OptionRuleResolver,
  type OptionsRange,
  type UpdateOptionRuleData,
  resolveOptionsRange,
} from "../domain/option-rule";

type Row = {
  id: string;
  institutionId: string;
  periodId: string;
  subjectId: string;
  minOptions: number;
  maxOptions: number;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
};

function toRule(r: Row): OptionRule {
  return {
    id: r.id,
    institutionId: r.institutionId,
    periodId: r.periodId,
    subjectId: r.subjectId,
    minOptions: r.minOptions,
    maxOptions: r.maxOptions,
    createdById: r.createdById,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * Rango del BANCO para una asignatura: la unión (la más permisiva) de las
 * reglas de esa asignatura en todas las pruebas. Si no hay ninguna regla,
 * el default estricto.
 */
function unionRange(rules: { minOptions: number; maxOptions: number }[]): OptionsRange {
  if (rules.length === 0) return DEFAULT_OPTIONS_RANGE;
  const min = Math.min(...rules.map((r) => r.minOptions));
  const max = Math.max(...rules.map((r) => r.maxOptions));
  return { min, max };
}

/**
 * P2021 = "the table does not exist in the current database".
 *
 * La tabla `SubjectOptionRule` llega con la migración
 * `20261030130000_add_subject_option_rules`. Si la app se levanta contra una
 * base donde esa migración todavía no está aplicada, Prisma tira P2021 y el
 * drawer de administración se cae ENTERO (arrastra el formulario de la
 * prueba, los tipos de cuadernillo y las reglas de conteo).
 *
 * Para que una tabla faltante no tumbe la app, ese caso se traduce a "no hay
 * reglas" (aplica el default estricto de 4 opciones) y se deja anotado en el
 * log con la instrucción de aplicar la migración.
 */
function isMissingTableError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "P2021"
  );
}

function logMissingTable(err: unknown): void {
  console.error(
    "[option-rules] Falta la tabla SubjectOptionRule: aplica la migración " +
      "20261030130000_add_subject_option_rules (pnpm prisma migrate deploy). " +
      "Mientras tanto se aplica el default estricto (exactamente 4 opciones).",
    err,
  );
}

export class PrismaOptionRuleRepository implements OptionRuleRepository, OptionRuleResolver {
  async findById(institutionId: string, id: string): Promise<OptionRule | null> {
    try {
      const row = await prisma.subjectOptionRule.findFirst({
        where: { id, institutionId },
      });
      return row ? toRule(row) : null;
    } catch (e) {
      if (isMissingTableError(e)) {
        logMissingTable(e);
        return null;
      }
      throw e;
    }
  }

  async listByPeriod(institutionId: string, periodId: string): Promise<OptionRule[]> {
    try {
      const rows = await prisma.subjectOptionRule.findMany({
        where: { institutionId, periodId },
        orderBy: [{ subjectId: "asc" }],
      });
      return rows.map(toRule);
    } catch (e) {
      if (isMissingTableError(e)) {
        logMissingTable(e);
        return [];
      }
      throw e;
    }
  }

  async listByInstitution(institutionId: string): Promise<OptionRule[]> {
    try {
      const rows = await prisma.subjectOptionRule.findMany({
        where: { institutionId },
        orderBy: [{ periodId: "asc" }, { subjectId: "asc" }],
      });
      return rows.map(toRule);
    } catch (e) {
      if (isMissingTableError(e)) {
        logMissingTable(e);
        return [];
      }
      throw e;
    }
  }

  async listBySubject(institutionId: string, subjectId: string): Promise<OptionRule[]> {
    try {
      const rows = await prisma.subjectOptionRule.findMany({
        where: { institutionId, subjectId },
        orderBy: [{ periodId: "asc" }],
      });
      return rows.map(toRule);
    } catch (e) {
      if (isMissingTableError(e)) {
        logMissingTable(e);
        return [];
      }
      throw e;
    }
  }

  async create(institutionId: string, data: CreateOptionRuleData): Promise<OptionRule> {
    const row = await prisma.subjectOptionRule.create({
      data: {
        institutionId,
        periodId: data.periodId,
        subjectId: data.subjectId,
        minOptions: data.minOptions,
        maxOptions: data.maxOptions,
        createdById: data.createdById,
      },
    });
    return toRule(row);
  }

  async update(
    institutionId: string,
    id: string,
    data: UpdateOptionRuleData,
  ): Promise<OptionRule | null> {
    const update: { minOptions?: number; maxOptions?: number } = {};
    if (data.minOptions !== undefined) update.minOptions = data.minOptions;
    if (data.maxOptions !== undefined) update.maxOptions = data.maxOptions;

    const result = await prisma.subjectOptionRule.updateMany({
      where: { id, institutionId },
      data: update,
    });
    if (result.count === 0) return null;
    const refreshed = await prisma.subjectOptionRule.findFirst({
      where: { id, institutionId },
    });
    return refreshed ? toRule(refreshed) : null;
  }

  async delete(institutionId: string, id: string): Promise<void> {
    await prisma.subjectOptionRule.deleteMany({ where: { id, institutionId } });
  }

  async findForCourseSubject(
    institutionId: string,
    courseSubjectId: string,
    periodId: string | null,
  ): Promise<OptionRule | null> {
    // Sin `periodId` no hay match posible: las reglas son por Prueba.
    if (periodId === null) return null;

    // 1. Resolver courseSubjectId → subjectId. El join a `Course` filtra
    //    por `institutionId`, así que un `courseSubjectId` de otra
    //    institución no matchea nada.
    const cs = await prisma.courseSubject.findFirst({
      where: {
        id: courseSubjectId,
        course: { institutionId },
      },
      select: { subjectId: true },
    });
    if (!cs) return null;

    // 2. Buscar la regla de (Prueba × Asignatura). El unique constraint
    //    garantiza ≤ 1 fila.
    try {
      const row = await prisma.subjectOptionRule.findFirst({
        where: {
          institutionId,
          periodId,
          subjectId: cs.subjectId,
        },
      });
      return row ? toRule(row) : null;
    } catch (e) {
      if (isMissingTableError(e)) {
        logMissingTable(e);
        return null;
      }
      throw e;
    }
  }

  // --- OptionRuleResolver -------------------------------------------------

  async forEvaluation(
    institutionId: string,
    courseSubjectId: string,
    periodId: string | null,
  ): Promise<OptionsRange> {
    const rule = await this.findForCourseSubject(institutionId, courseSubjectId, periodId);
    return resolveOptionsRange(rule);
  }

  async forSubject(institutionId: string, subjectId: string): Promise<OptionsRange> {
    const rules = await this.listBySubject(institutionId, subjectId);
    return unionRange(rules);
  }

  async forSubjects(
    institutionId: string,
    subjectIds: string[],
  ): Promise<Record<string, OptionsRange>> {
    const ranges: Record<string, OptionsRange> = {};
    for (const subjectId of subjectIds) {
      ranges[subjectId] = DEFAULT_OPTIONS_RANGE;
    }
    if (subjectIds.length === 0) return ranges;

    let rules: { subjectId: string; minOptions: number; maxOptions: number }[] = [];
    try {
      rules = await prisma.subjectOptionRule.findMany({
        where: { institutionId, subjectId: { in: subjectIds } },
        select: { subjectId: true, minOptions: true, maxOptions: true },
      });
    } catch (e) {
      if (isMissingTableError(e)) {
        logMissingTable(e);
        return ranges;
      }
      throw e;
    }
    const bySubject = new Map<string, { minOptions: number; maxOptions: number }[]>();
    for (const r of rules) {
      const list = bySubject.get(r.subjectId) ?? [];
      list.push({ minOptions: r.minOptions, maxOptions: r.maxOptions });
      bySubject.set(r.subjectId, list);
    }
    for (const [subjectId, list] of bySubject) {
      ranges[subjectId] = unionRange(list);
    }
    return ranges;
  }
}
