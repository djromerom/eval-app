import {
  PrismaAcademicYearRepository,
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
import { AssignStudentToYear, ChangeStudentEnrollment } from "../application/student-enrollments";
import { PrismaStudentEnrollmentRepository } from "./prisma-student-enrollment-repository";
import { PrismaStudentRepository } from "./prisma-student-repository";

/** Composition root del módulo students. */
const students = new PrismaStudentRepository();
const enrollments = new PrismaStudentEnrollmentRepository();
const years = new PrismaAcademicYearRepository();
const groups = new PrismaGroupRepository();
const periods = new PrismaPeriodRepository();
const bookletTypes = new PrismaBookletTypeRepository();

// `CreateStudent` e `ImportStudents` ahora resuelven el año académico actual
// para matricular a cada estudiante — por eso necesitan `years`.
export const makeCreateStudent = () => new CreateStudent(students, groups, years);
export const makeListStudents = () => new ListStudents(students);
export const makeChangeStudentCode = () => new ChangeStudentCode(students);
export const makeImportStudents = () =>
  new ImportStudents(students, groups, periods, bookletTypes, years);
export const makeGetStudent = () => new GetStudent(students);
export const makeUpdateStudent = () => new UpdateStudent(students, groups, years);
export const makeDeleteStudent = () => new DeleteStudent(students);

// StudentEnrollment use cases (wiring — los use cases en sí están en
// commit 3; aquí solo se exponen al composition root).
export const makeAssignStudentToYear = () => new AssignStudentToYear(enrollments, students, years);
export const makeChangeStudentEnrollment = () => new ChangeStudentEnrollment(enrollments, students);
