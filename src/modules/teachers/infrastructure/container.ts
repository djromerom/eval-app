import { PrismaCourseSubjectRepository } from "@/modules/academic/infrastructure/prisma-academic-repositories";
import { loadSmtpConfig } from "@/shared/infrastructure/email/config";
import { SmtpEmailService } from "@/shared/infrastructure/email/service";
import {
  AssignTeacher,
  CompleteTeacherProfile,
  CreateTeacher,
  EnsureTeacherProfile,
  ListTeacherAssignments,
  ListTeachers,
  ResendTeacherInvitation,
} from "../application/teachers";
import { PrismaTeacherRepository } from "./prisma-teacher-repository";

const teachers = new PrismaTeacherRepository();
const courseSubjects = new PrismaCourseSubjectRepository();

const smtpConfig = loadSmtpConfig();
const emailService = smtpConfig ? new SmtpEmailService(smtpConfig) : undefined;

export const makeCreateTeacher = () => new CreateTeacher(teachers, emailService);
export const makeResendTeacherInvitation = () =>
  new ResendTeacherInvitation(teachers, emailService);
export const makeEnsureTeacherProfile = () => new EnsureTeacherProfile(teachers);
export const makeCompleteTeacherProfile = () => new CompleteTeacherProfile(teachers);
export const makeListTeachers = () => new ListTeachers(teachers);
export const makeAssignTeacher = () => new AssignTeacher(teachers, courseSubjects);
export const makeListTeacherAssignments = () => new ListTeacherAssignments(teachers);
