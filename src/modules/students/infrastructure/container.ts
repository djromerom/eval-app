import {
  PrismaGroupRepository,
  PrismaPeriodRepository,
} from "@/modules/academic/infrastructure/prisma-academic-repositories";
import { PrismaBookletTypeRepository } from "@/modules/booklet-types/infrastructure/prisma-booklet-type-repository";
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
const periods = new PrismaPeriodRepository();
const bookletTypes = new PrismaBookletTypeRepository();

export const makeCreateStudent = () => new CreateStudent(students, groups);
export const makeListStudents = () => new ListStudents(students);
export const makeChangeStudentCode = () => new ChangeStudentCode(students);
export const makeImportStudents = () => new ImportStudents(students, groups, periods, bookletTypes);
export const makeGetStudent = () => new GetStudent(students);
export const makeUpdateStudent = () => new UpdateStudent(students, groups);
export const makeDeleteStudent = () => new DeleteStudent(students);
