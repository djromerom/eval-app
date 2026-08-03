import { CreateAcademicYear, ListAcademicYears } from "../application/academic-years";
import {
  CreateCourseSubject,
  DeleteCourseSubject,
  ListCourseSubjects,
} from "../application/course-subjects";
import { CreateCourse, ListCourses } from "../application/courses";
import { CreateGroup, DeleteGroup, ListGroups } from "../application/groups";
import {
  CreatePeriod,
  DeletePeriod,
  GetPeriod,
  ListPeriods,
  SetCurrentPeriod,
  UpdatePeriod,
} from "../application/periods";
import { CreateSubject, ListSubjects } from "../application/subjects";
import { PrismaTeacherRepository } from "@/modules/teachers/infrastructure/prisma-teacher-repository";
import {
  PrismaAcademicYearRepository,
  PrismaCourseRepository,
  PrismaCourseSubjectRepository,
  PrismaGroupRepository,
  PrismaPeriodRepository,
  PrismaSubjectRepository,
} from "./prisma-academic-repositories";

/** Composition root del módulo academic. */
const years = new PrismaAcademicYearRepository();
const courses = new PrismaCourseRepository();
const subjects = new PrismaSubjectRepository();
const groups = new PrismaGroupRepository();
const periods = new PrismaPeriodRepository();
const courseSubjects = new PrismaCourseSubjectRepository();
const teachers = new PrismaTeacherRepository();

export const makeCreateAcademicYear = () => new CreateAcademicYear(years);
export const makeListAcademicYears = () => new ListAcademicYears(years);

export const makeCreateCourse = () => new CreateCourse(courses, years);
export const makeListCourses = () => new ListCourses(courses);

export const makeCreateSubject = () => new CreateSubject(subjects);
export const makeListSubjects = () => new ListSubjects(subjects);

export const makeCreateGroup = () => new CreateGroup(groups, courses);
export const makeListGroups = () => new ListGroups(groups);
export const makeDeleteGroup = () => new DeleteGroup(groups);

export const makeCreatePeriod = () => new CreatePeriod(periods, years);
export const makeListPeriods = () => new ListPeriods(periods);
export const makeGetPeriod = () => new GetPeriod(periods);
export const makeUpdatePeriod = () => new UpdatePeriod(periods, years);
export const makeDeletePeriod = () => new DeletePeriod(periods);
export const makeSetCurrentPeriod = () => new SetCurrentPeriod(periods);

export const makeCreateCourseSubject = () =>
  new CreateCourseSubject(courseSubjects, courses, subjects);
export const makeListCourseSubjects = () => new ListCourseSubjects(courseSubjects, teachers);
export const makeDeleteCourseSubject = () => new DeleteCourseSubject(courseSubjects, courses);
