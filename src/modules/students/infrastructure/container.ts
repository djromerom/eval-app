import { PrismaGroupRepository } from "@/modules/academic/infrastructure/prisma-academic-repositories";
import {
  ChangeStudentCode,
  CreateStudent,
  ImportStudents,
  ListStudents,
} from "../application/students";
import { PrismaStudentRepository } from "./prisma-student-repository";

/** Composition root del módulo students. */
const students = new PrismaStudentRepository();
const groups = new PrismaGroupRepository();

export const makeCreateStudent = () => new CreateStudent(students, groups);
export const makeListStudents = () => new ListStudents(students);
export const makeChangeStudentCode = () => new ChangeStudentCode(students);
export const makeImportStudents = () => new ImportStudents(students, groups);
