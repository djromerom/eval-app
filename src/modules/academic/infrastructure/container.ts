import { CreateAcademicYear, ListAcademicYears } from "../application/academic-years";
import { CreateCourse, ListCourses } from "../application/courses";
import { CreateGroup, ListGroups } from "../application/groups";
import { CreatePeriod, ListPeriods } from "../application/periods";
import { CreateSubject, ListSubjects } from "../application/subjects";
import {
  PrismaAcademicYearRepository,
  PrismaCourseRepository,
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

export const makeCreateAcademicYear = () => new CreateAcademicYear(years);
export const makeListAcademicYears = () => new ListAcademicYears(years);

export const makeCreateCourse = () => new CreateCourse(courses, years);
export const makeListCourses = () => new ListCourses(courses);

export const makeCreateSubject = () => new CreateSubject(subjects);
export const makeListSubjects = () => new ListSubjects(subjects);

export const makeCreateGroup = () => new CreateGroup(groups, courses);
export const makeListGroups = () => new ListGroups(groups);

export const makeCreatePeriod = () => new CreatePeriod(periods, years);
export const makeListPeriods = () => new ListPeriods(periods);
