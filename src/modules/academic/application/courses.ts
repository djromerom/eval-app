import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import {
  type AcademicYearRepository,
  type Course,
  type CourseRepository,
  type CreateCourseData,
  isValidCode,
} from "../domain/types";

export interface CreateCourseInput {
  actor: AuthenticatedUser;
  data: CreateCourseData;
}

/** Crea un curso (grado) ligado a un año académico de la institución (ADMIN). */
export class CreateCourse implements UseCase<CreateCourseInput, Course> {
  constructor(
    private readonly courses: CourseRepository,
    private readonly years: AcademicYearRepository,
  ) {}

  async execute({ actor, data }: CreateCourseInput): Promise<Result<Course>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    if (!data.name.trim()) return fail(new ValidationError("El nombre del curso es obligatorio."));
    if (!isValidCode(data.code)) return fail(new ValidationError("Código de curso inválido."));

    const year = await this.years.findById(actor.institutionId, data.academicYearId);
    if (!year) {
      return fail(new ValidationError("El año académico indicado no existe en tu institución."));
    }

    return ok(await this.courses.create(actor.institutionId, data));
  }
}

export interface ListCoursesInput {
  actor: AuthenticatedUser;
  academicYearId?: string;
}

export class ListCourses implements UseCase<ListCoursesInput, Course[]> {
  constructor(private readonly courses: CourseRepository) {}

  async execute({ actor, academicYearId }: ListCoursesInput): Promise<Result<Course[]>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;
    return ok(await this.courses.findAll(actor.institutionId, academicYearId));
  }
}
