import {
  PrismaCourseSubjectRepository,
  PrismaPeriodRepository,
} from "@/modules/academic/infrastructure/prisma-academic-repositories";
import { notificationSender } from "@/modules/notifications/infrastructure/container";
import { PrismaUserRepository } from "@/modules/users/infrastructure/prisma-user-repository";
import { ChangeEvaluationStatus, type CoordinatorDirectory } from "../application/change-status";
import {
  AddQuestion,
  AddSection,
  CreateEvaluation,
  GetEvaluation,
  ListEvaluations,
} from "../application/manage-evaluations";
import { PrismaEvaluationRepository } from "./prisma-evaluation-repository";

/** Composition root del módulo evaluations. */
const evaluations = new PrismaEvaluationRepository();
const courseSubjects = new PrismaCourseSubjectRepository();
const periods = new PrismaPeriodRepository();
const users = new PrismaUserRepository();

const coordinatorDirectory: CoordinatorDirectory = {
  coordinatorIds: (institutionId) => users.findIdsByRole(institutionId, "COORDINATOR"),
};

export const makeCreateEvaluation = () =>
  new CreateEvaluation(evaluations, courseSubjects, periods);
export const makeListEvaluations = () => new ListEvaluations(evaluations);
export const makeGetEvaluation = () => new GetEvaluation(evaluations);
export const makeAddSection = () => new AddSection(evaluations);
export const makeAddQuestion = () => new AddQuestion(evaluations);
export const makeChangeEvaluationStatus = () =>
  new ChangeEvaluationStatus(evaluations, notificationSender, coordinatorDirectory);
