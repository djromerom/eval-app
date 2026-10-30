/**
 * Casos de uso de RESOLUCIÓN del rango de opciones.
 *
 * Son los que consumen las páginas (editor de formulaciones, banco de
 * preguntas) para saber cuántas opciones puede tener una pregunta antes de
 * renderizar el formulario: el editor tiene que ofrecer exactamente el
 * rango permitido, no el rango global por defecto.
 */

import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ok } from "@/shared/domain/result";

import type { OptionRuleResolver, OptionsRange } from "../domain/option-rule";

// ---------------------------------------------------------------------------
// ResolveOptionsRangeForEvaluation
// ---------------------------------------------------------------------------

export interface ResolveOptionsRangeForEvaluationInput {
  actor: AuthenticatedUser;
  /** `courseSubjectId` de la evaluación (grado × asignatura). */
  courseSubjectId: string;
  /** `periodId` de la evaluación; null → no hay regla → default estricto. */
  periodId: string | null;
}

/**
 * Rango de opciones aplicable a una evaluación: el de la regla
 * (Prueba × Grado × Asignatura) o, si no hay regla, el default estricto
 * (exactamente 4 opciones).
 *
 * La evaluación conoce su `courseSubjectId` (grado × asignatura) y su
 * `periodId` (prueba), así que el match de la regla es exacto.
 */
export class ResolveOptionsRangeForEvaluation implements UseCase<
  ResolveOptionsRangeForEvaluationInput,
  OptionsRange
> {
  constructor(private readonly resolver: OptionRuleResolver) {}

  async execute({
    actor,
    courseSubjectId,
    periodId,
  }: ResolveOptionsRangeForEvaluationInput): Promise<Result<OptionsRange>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER", "TEACHER");
    if (!authorized.ok) return authorized;

    const range = await this.resolver.forEvaluation(actor.institutionId, courseSubjectId, periodId);
    return ok(range);
  }
}

// ---------------------------------------------------------------------------
// ResolveOptionsRangeForSubject
// ---------------------------------------------------------------------------

export interface ResolveOptionsRangeForSubjectInput {
  actor: AuthenticatedUser;
  subjectId: string;
}

/**
 * Rango de opciones aplicable al BANCO de preguntas de una asignatura.
 *
 * El banco es institucional (no pertenece a una Prueba ni a un grado), así
 * que el rango es la unión de las reglas de esa asignatura en todos los
 * grados y pruebas: el más permisivo. Al importar la pregunta a una
 * evaluación se valida contra el rango de ESA evaluación, que sí es por
 * Prueba y grado.
 */
export class ResolveOptionsRangeForSubject implements UseCase<
  ResolveOptionsRangeForSubjectInput,
  OptionsRange
> {
  constructor(private readonly resolver: OptionRuleResolver) {}

  async execute({
    actor,
    subjectId,
  }: ResolveOptionsRangeForSubjectInput): Promise<Result<OptionsRange>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER", "TEACHER");
    if (!authorized.ok) return authorized;

    const range = await this.resolver.forSubject(actor.institutionId, subjectId);
    return ok(range);
  }
}

// ---------------------------------------------------------------------------
// ResolveOptionsRangesForSubjects
// ---------------------------------------------------------------------------

export interface ResolveOptionsRangesForSubjectsInput {
  actor: AuthenticatedUser;
  subjectIds: string[];
}

/**
 * Rangos del banco para varias asignaturas de una vez (el listado del
 * banco arma un selector de asignatura → rango).
 */
export class ResolveOptionsRangesForSubjects implements UseCase<
  ResolveOptionsRangesForSubjectsInput,
  Record<string, OptionsRange>
> {
  constructor(private readonly resolver: OptionRuleResolver) {}

  async execute({
    actor,
    subjectIds,
  }: ResolveOptionsRangesForSubjectsInput): Promise<Result<Record<string, OptionsRange>>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER", "TEACHER");
    if (!authorized.ok) return authorized;

    const ranges = await this.resolver.forSubjects(actor.institutionId, subjectIds);
    return ok(ranges);
  }
}
