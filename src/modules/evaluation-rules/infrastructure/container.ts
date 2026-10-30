/**
 * Composition root del módulo evaluation-rules.
 *
 * Las factories de use cases (Create/List/Update/Delete/FindForEvaluation)
 * reciben sus dependencias por constructor (hexagonal puro).
 */

import {
  PrismaCourseRepository,
  PrismaPeriodRepository,
  PrismaSubjectRepository,
} from "@/modules/academic/infrastructure/prisma-academic-repositories";
import { PrismaBookletTypeRepository } from "@/modules/booklet-types/infrastructure/prisma-booklet-type-repository";
import { PrismaEvaluationRepository } from "@/modules/evaluations/infrastructure/prisma-evaluation-repository";

import {
  CreateEvaluationRule,
  DeleteEvaluationRule,
  FindRuleForEvaluation,
  ListEvaluationRulesByInstitution,
  ListEvaluationRulesByPeriod,
  UpdateEvaluationRule,
} from "../application/manage-evaluation-rules";
import { CloneEvaluationRules } from "../application/clone-evaluation-rules";
import { PrismaEvaluationRuleRepository } from "./prisma-evaluation-rule-repository";

const rules = new PrismaEvaluationRuleRepository();
const evaluations = new PrismaEvaluationRepository();
const periods = new PrismaPeriodRepository();
const courses = new PrismaCourseRepository();
const subjects = new PrismaSubjectRepository();
const bookletTypes = new PrismaBookletTypeRepository();

/** Repositorio singleton — exportado para que los use cases de otros
 *  módulos (enforcement en ChangeEvaluationStatus / AddQuestion /
 *  DeleteQuestion / DuplicateQuestion) lo consuman directamente sin
 *  duplicar instancias. */
export const evaluationRules = rules;

export const makeCreateEvaluationRule = () =>
  new CreateEvaluationRule(rules, periods, courses, subjects, bookletTypes);
export const makeListEvaluationRulesByPeriod = () => new ListEvaluationRulesByPeriod(rules);
export const makeListEvaluationRulesByInstitution = () =>
  new ListEvaluationRulesByInstitution(rules);
export const makeUpdateEvaluationRule = () => new UpdateEvaluationRule(rules);
export const makeDeleteEvaluationRule = () => new DeleteEvaluationRule(rules);
export const makeFindRuleForEvaluation = () => new FindRuleForEvaluation(evaluations, rules);

/** Clona las reglas de una Prueba a otra conservando las ya existentes. */
export const makeCloneEvaluationRules = () =>
  new CloneEvaluationRules(
    rules,
    periods,
    courses,
    subjects,
    bookletTypes,
    makeCreateEvaluationRule(),
  );

export type { EvaluationRuleRepository } from "../domain/evaluation-rule";
