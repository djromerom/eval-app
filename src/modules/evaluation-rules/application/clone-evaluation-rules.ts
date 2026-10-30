/**
 * `CloneEvaluationRules`: copia las reglas de conteo exacto de una Prueba a
 * otra, conservando las que ya existen en el destino.
 *
 * Por qué existe: el admin configura el conteo exacto en una Prueba (ej.
 * "2026-2") y quiere llevarlo a otra (ej. "2026-3") sin volver a teclear
 * cada combinación. Pero las reglas NO son copiables tal cual: apuntan a
 * un `bookletTypeId` y a un `courseId` que pertenecen a la Prueba de origen.
 *
 * El mapeo que hace este use case:
 * - **Tipo de cuadernillo** → el tipo del destino con el MISMO nombre
 *   (comparación normalizada: "Estandar" del origen encuentra "Estándar"
 *   del destino). Si el destino no tiene equivalente → la regla se omite.
 * - **Grado** → si el destino es del mismo año académico, el mismo grado.
 *   Si es de otro año, el grado con el MISMO `code` en el año destino; si
 *   no existe → la regla se omite.
 * - **Asignatura** → es catálogo de la institución (no tiene año), así que
 *   el id se conserva.
 *
 * Regla de oro: **una regla que ya existe en el destino NO se duplica ni se
 * reescribe**. Se conserva tal cual (con su conteo actual) y se reporta como
 * "conservada". Solo se crean las que faltan.
 */

import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { NotFoundError, type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import type {
  BookletType,
  BookletTypeRepository,
} from "@/modules/booklet-types/domain/booklet-type";
import { normalizeBookletTypeName } from "@/modules/booklet-types/domain/booklet-type";
import type {
  CourseRepository,
  PeriodRepository,
  SubjectRepository,
} from "@/modules/academic/domain/types";

import type { EvaluationRuleRepository } from "../domain/evaluation-rule";
import { CreateEvaluationRule } from "./manage-evaluation-rules";

/** Qué pasó con cada regla de origen. */
export type CloneRuleStatus = "clonada" | "conservada" | "omitida";

export interface CloneRuleOutcome {
  status: CloneRuleStatus;
  /** Ids de la regla CREADA en el destino (solo si se clonó). */
  courseId?: string;
  subjectId?: string;
  bookletTypeId?: string;
  /** Grado de la regla de origen. */
  courseName: string;
  /** Asignatura de la regla de origen. */
  subjectName: string;
  /** Tipo de cuadernillo de la regla de origen. */
  bookletTypeName: string;
  /** Conteo exacto que tenía la regla de origen. */
  exactQuestions: number;
  /** Por qué se conservó o se omitió (vacío si se clonó). */
  motivo?: string;
}

export interface CloneEvaluationRulesInput {
  actor: AuthenticatedUser;
  /** Prueba de la que se copian las reglas. */
  sourcePeriodId: string;
  /** Prueba a la que se copian. */
  targetPeriodId: string;
}

export interface CloneEvaluationRulesOutput {
  /** Reglas creadas en el destino. */
  cloned: number;
  /** Reglas que ya existían en el destino y se dejaron como estaban. */
  kept: number;
  /** Reglas que no se pudieron copiar (sin equivalente en el destino). */
  skipped: number;
  /** Detalle regla por regla. */
  outcomes: CloneRuleOutcome[];
}

/** Clave de identidad de una regla dentro de una Prueba. */
function ruleKey(courseId: string, subjectId: string, bookletTypeId: string): string {
  return `${courseId}|${subjectId}|${bookletTypeId}`;
}

export class CloneEvaluationRules implements UseCase<
  CloneEvaluationRulesInput,
  CloneEvaluationRulesOutput
> {
  constructor(
    private readonly rules: EvaluationRuleRepository,
    private readonly periods: PeriodRepository,
    private readonly courses: CourseRepository,
    private readonly subjects: SubjectRepository,
    private readonly bookletTypes: BookletTypeRepository,
    /** Se reutiliza el caso de uso de creación: así el clon inherits sus
     *  validaciones de FK y su control de duplicados. */
    private readonly createRule: CreateEvaluationRule,
  ) {}

  async execute({
    actor,
    sourcePeriodId,
    targetPeriodId,
  }: CloneEvaluationRulesInput): Promise<Result<CloneEvaluationRulesOutput>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    if (sourcePeriodId === targetPeriodId) {
      return fail(new ValidationError("La prueba de origen y la de destino son la misma."));
    }

    const [source, target] = await Promise.all([
      this.periods.findById(actor.institutionId, sourcePeriodId),
      this.periods.findById(actor.institutionId, targetPeriodId),
    ]);
    if (!source) return fail(new NotFoundError("Prueba de origen", sourcePeriodId));
    if (!target) return fail(new NotFoundError("Prueba de destino", targetPeriodId));

    const [sourceRules, targetRules, sourceTypes, targetTypes] = await Promise.all([
      this.rules.listByPeriod(actor.institutionId, sourcePeriodId),
      this.rules.listByPeriod(actor.institutionId, targetPeriodId),
      this.bookletTypes.listByPeriod(actor.institutionId, sourcePeriodId),
      this.bookletTypes.listByPeriod(actor.institutionId, targetPeriodId),
    ]);

    // Tipos del destino indexados por nombre normalizado: el "Estandar" del
    // origen encuentra el "Estándar" del destino.
    const targetTypeByName = new Map<string, BookletType>();
    for (const t of targetTypes) {
      const key = normalizeBookletTypeName(t.name);
      // Si hay varias grafías equivalentes en el destino, gana la primera
      // (el `order` del repo ya viene por `order asc`).
      if (!targetTypeByName.has(key)) targetTypeByName.set(key, t);
    }

    // Grados del año del destino: permiten clonar entre años académicos.
    const targetCourses = await this.courses.findAll(actor.institutionId, target.academicYearId);
    const targetCourseByCode = new Map(targetCourses.map((c) => [c.code, c]));

    // Reglas que YA existen en el destino: no se tocan ni se reescriben.
    const existing = new Set(
      targetRules.map((r) => ruleKey(r.courseId, r.subjectId, r.bookletTypeId)),
    );

    const outcomes: CloneRuleOutcome[] = [];
    let cloned = 0;
    let kept = 0;
    let skipped = 0;

    for (const rule of sourceRules) {
      const course = await this.courses.findById(actor.institutionId, rule.courseId);
      const subject = await this.subjects.findById(rule.subjectId);
      const sourceType = sourceTypes.find((t) => t.id === rule.bookletTypeId) ?? null;

      const base = {
        courseName: course?.name ?? "—",
        subjectName: subject?.name ?? "—",
        bookletTypeName: sourceType?.name ?? "—",
        exactQuestions: rule.exactQuestions,
      };

      // 1) Tipo de cuadernillo equivalente en el destino.
      const targetType = sourceType
        ? targetTypeByName.get(normalizeBookletTypeName(sourceType.name))
        : undefined;
      if (!targetType) {
        skipped++;
        outcomes.push({
          ...base,
          status: "omitida",
          motivo: "esta prueba no tiene un tipo de cuadernillo equivalente",
        });
        continue;
      }

      // 2) Grado equivalente: mismo año → el mismo grado; otro año → el
      //    grado con el mismo código en el año del destino.
      let targetCourseId = rule.courseId;
      if (course && course.academicYearId !== target.academicYearId) {
        const equivalent = targetCourseByCode.get(course.code);
        if (!equivalent) {
          skipped++;
          outcomes.push({
            ...base,
            status: "omitida",
            motivo: "esta prueba no tiene un grado equivalente",
          });
          continue;
        }
        targetCourseId = equivalent.id;
      }

      // 3) Si ya existe una regla para esa tupla → se conserva tal cual.
      const key = ruleKey(targetCourseId, rule.subjectId, targetType.id);
      if (existing.has(key)) {
        kept++;
        outcomes.push({
          ...base,
          status: "conservada",
          motivo: "ya existía una regla para esta combinación",
        });
        continue;
      }

      // 4) Crear la regla en el destino.
      const created = await this.createRule.execute({
        actor,
        data: {
          periodId: targetPeriodId,
          courseId: targetCourseId,
          subjectId: rule.subjectId,
          bookletTypeId: targetType.id,
          exactQuestions: rule.exactQuestions,
        },
      });

      if (created.ok) {
        cloned++;
        existing.add(key);
        outcomes.push({
          ...base,
          status: "clonada",
          courseId: created.value.courseId,
          subjectId: created.value.subjectId,
          bookletTypeId: created.value.bookletTypeId,
        });
        continue;
      }

      // Carrera contra otro admin: el unique de Postgres rejected el alta.
      if (created.error.code === "CONFLICT") {
        kept++;
        outcomes.push({
          ...base,
          status: "conservada",
          motivo: "ya existía una regla para esta combinación",
        });
        continue;
      }

      skipped++;
      outcomes.push({ ...base, status: "omitida", motivo: created.error.message });
    }

    return ok({ cloned, kept, skipped, outcomes });
  }
}
