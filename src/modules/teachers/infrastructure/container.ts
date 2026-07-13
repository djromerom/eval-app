import { PrismaCourseSubjectRepository } from "@/modules/academic/infrastructure/prisma-academic-repositories";
import { loadSmtpConfig } from "@/shared/infrastructure/email/config";
import { SmtpEmailService } from "@/shared/infrastructure/email/service";
import {
  AssignTeacher,
  CreateTeacher,
  ListTeacherAssignments,
  ListTeachers,
} from "../application/teachers";
import { PrismaTeacherRepository } from "./prisma-teacher-repository";

const teachers = new PrismaTeacherRepository();
const courseSubjects = new PrismaCourseSubjectRepository();

const smtpConfig = loadSmtpConfig();
const emailService = smtpConfig ? new SmtpEmailService(smtpConfig) : undefined;

export const makeCreateTeacher = () => new CreateTeacher(teachers, emailService);
export const makeListTeachers = () => new ListTeachers(teachers);
export const makeAssignTeacher = () => new AssignTeacher(teachers, courseSubjects);
export const makeListTeacherAssignments = () => new ListTeacherAssignments(teachers);
