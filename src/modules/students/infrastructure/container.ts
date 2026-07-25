import { PrismaGroupRepository } from "@/modules/academic/infrastructure/prisma-academic-repositories";
import {
  ChangeStudentCode,
  CreateStudent,
  DeleteStudent,
  GetStudent,
  ImportStudents,
  ListStudents,
  UpdateStudent,
} from "../application/students";
import { PrismaStudentRepository } from "./prisma-student-repository";

/** Composition root del módulo students. */
const students = new PrismaStudentRepository();
const groups = new PrismaGroupRepository();

export const makeCreateStudent = () => new CreateStudent(students, groups);
export const makeListStudents = () => new ListStudents(students);
export const makeChangeStudentCode = () => new ChangeStudentCode(students);
export const makeImportStudents = () => new ImportStudents(students, groups);
export const makeGetStudent = () => new GetStudent(students);
export const makeUpdateStudent = () => new UpdateStudent(students, groups);
export const makeDeleteStudent = () => new DeleteStudent(students);
