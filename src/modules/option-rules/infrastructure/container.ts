/**
 * Composition root del módulo option-rules.
 *
 * Las factories de use cases (Create/List/Update/Delete/Resolve) reciben
 * sus dependencias por constructor (hexagonal puro).
 */

import {
  PrismaCourseRepository,
  PrismaCourseSubjectRepository,
  PrismaPeriodRepository,
  PrismaSubjectRepository,
} from "@/modules/academic/infrastructure/prisma-academic-repositories";

import {
  CreateOptionRule,
  DeleteOptionRule,
  ListOptionRulesByInstitution,
  ListOptionRulesByPeriod,
  UpdateOptionRule,
} from "../application/manage-option-rules";
import {
  ResolveOptionsRangeForEvaluation,
  ResolveOptionsRangeForSubject,
  ResolveOptionsRangesForSubjects,
} from "../application/resolve-options-range";
import { PrismaOptionRuleRepository } from "./prisma-option-rule-repository";

const rules = new PrismaOptionRuleRepository();
const periods = new PrismaPeriodRepository();
const courses = new PrismaCourseRepository();
const courseSubjects = new PrismaCourseSubjectRepository();
const subjects = new PrismaSubjectRepository();

/** Repositorio singleton — exportado para que los use cases de otros módulos
 *  (enforcement al crear/editar preguntas) lo consuman directamente sin
 *  duplicar instancias. Implementa también `OptionRuleResolver`. */
export const optionRules = rules;

export const makeCreateOptionRule = () =>
  new CreateOptionRule(rules, periods, courses, courseSubjects, subjects);
export const makeListOptionRulesByPeriod = () => new ListOptionRulesByPeriod(rules);
export const makeListOptionRulesByInstitution = () => new ListOptionRulesByInstitution(rules);
export const makeUpdateOptionRule = () => new UpdateOptionRule(rules);
export const makeDeleteOptionRule = () => new DeleteOptionRule(rules);

export const makeResolveOptionsRangeForEvaluation = () =>
  new ResolveOptionsRangeForEvaluation(rules);
export const makeResolveOptionsRangeForSubject = () => new ResolveOptionsRangeForSubject(rules);
export const makeResolveOptionsRangesForSubjects = () => new ResolveOptionsRangesForSubjects(rules);

export type { OptionRuleRepository, OptionRuleResolver, OptionsRange } from "../domain/option-rule";
