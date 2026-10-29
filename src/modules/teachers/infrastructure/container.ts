import {
  PrismaCourseRepository,
  PrismaCourseSubjectRepository,
  PrismaPeriodRepository,
} from "@/modules/academic/infrastructure/prisma-academic-repositories";
import { PrismaBookletTypeRepository } from "@/modules/booklet-types/infrastructure/prisma-booklet-type-repository";
import { loadSmtpConfig } from "@/shared/infrastructure/email/config";
import { SmtpEmailService } from "@/shared/infrastructure/email/service";
import {
  AssignTeacher,
  CompleteTeacherProfile,
  CreateTeacher,
  EnsureTeacherProfile,
  ImportTeachers,
  ListTeacherAssignments,
  ListTeachers,
  ResendTeacherInvitation,
} from "../application/teachers";
import { PrismaTeacherRepository } from "./prisma-teacher-repository";

const teachers = new PrismaTeacherRepository();
const courseSubjects = new PrismaCourseSubjectRepository();
const courses = new PrismaCourseRepository();
const periods = new PrismaPeriodRepository();
const bookletTypes = new PrismaBookletTypeRepository();

const smtpConfig = loadSmtpConfig();
const emailService = smtpConfig ? new SmtpEmailService(smtpConfig) : undefined;

export const makeCreateTeacher = () => new CreateTeacher(teachers, emailService);
export const makeResendTeacherInvitation = () =>
  new ResendTeacherInvitation(teachers, emailService);
export const makeImportTeachers = () => new ImportTeachers(teachers, makeCreateTeacher());
export const makeEnsureTeacherProfile = () => new EnsureTeacherProfile(teachers);
export const makeCompleteTeacherProfile = () => new CompleteTeacherProfile(teachers);
export const makeListTeachers = () => new ListTeachers(teachers);
export const makeAssignTeacher = () =>
  new AssignTeacher(teachers, courseSubjects, bookletTypes, courses, periods);
export const makeListTeacherAssignments = () => new ListTeacherAssignments(teachers);
