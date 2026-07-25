import {
  PrismaCourseRepository,
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
  DeleteQuestion,
  DeleteSection,
  DuplicateQuestion,
  GetEvaluation,
  ListEvaluations,
  ReorderQuestions,
  UpdateEvaluationSettings,
  UpdateQuestion,
  UpdateSection,
} from "../application/manage-evaluations";
import {
  ApplyTemplate,
  CreateTemplate,
  DeleteTemplate,
  GetTemplate,
  ListTemplates,
} from "../application/manage-templates";
import { PrismaEvaluationRepository } from "./prisma-evaluation-repository";
import { PrismaTemplateRepository } from "./prisma-template-repository";

/** Composition root del módulo evaluations. */
const evaluations = new PrismaEvaluationRepository();
const templates = new PrismaTemplateRepository();
const courseSubjects = new PrismaCourseSubjectRepository();
const courses = new PrismaCourseRepository();
const periods = new PrismaPeriodRepository();
const users = new PrismaUserRepository();

const coordinatorDirectory: CoordinatorDirectory = {
  coordinatorIds: (institutionId) => users.findIdsByRole(institutionId, "COORDINATOR"),
};

export const makeCreateEvaluation = () =>
  new CreateEvaluation(evaluations, courseSubjects, periods, courses);
export const makeListEvaluations = () => new ListEvaluations(evaluations);
export const makeGetEvaluation = () => new GetEvaluation(evaluations);
export const makeAddSection = () => new AddSection(evaluations);
export const makeUpdateSection = () => new UpdateSection(evaluations);
export const makeDeleteSection = () => new DeleteSection(evaluations);
export const makeAddQuestion = () => new AddQuestion(evaluations);
export const makeUpdateQuestion = () => new UpdateQuestion(evaluations);
export const makeDeleteQuestion = () => new DeleteQuestion(evaluations);
export const makeDuplicateQuestion = () => new DuplicateQuestion(evaluations);
export const makeReorderQuestions = () => new ReorderQuestions(evaluations);
export const makeUpdateEvaluationSettings = () => new UpdateEvaluationSettings(evaluations);
export const makeChangeEvaluationStatus = () =>
  new ChangeEvaluationStatus(evaluations, notificationSender, coordinatorDirectory);

// Templates
export const makeCreateTemplate = () => new CreateTemplate(templates, courseSubjects);
export const makeListTemplates = () => new ListTemplates(templates);
export const makeGetTemplate = () => new GetTemplate(templates);
export const makeDeleteTemplate = () => new DeleteTemplate(templates);
export const makeApplyTemplate = () => new ApplyTemplate(templates, evaluations);
