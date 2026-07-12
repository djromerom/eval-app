import { PrismaCourseSubjectRepository } from "@/modules/academic/infrastructure/prisma-academic-repositories";
import {
  AssignTeacher,
  CreateTeacher,
  ListTeacherAssignments,
  ListTeachers,
} from "../application/teachers";
import { PrismaTeacherRepository } from "./prisma-teacher-repository";

/** Composition root del módulo teachers. */
const teachers = new PrismaTeacherRepository();
const courseSubjects = new PrismaCourseSubjectRepository();

export const makeCreateTeacher = () => new CreateTeacher(teachers);
export const makeListTeachers = () => new ListTeachers(teachers);
export const makeAssignTeacher = () => new AssignTeacher(teachers, courseSubjects);
export const makeListTeacherAssignments = () => new ListTeacherAssignments(teachers);
