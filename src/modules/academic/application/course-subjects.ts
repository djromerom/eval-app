import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import type {
  CourseRepository,
  CourseSubject,
  CourseSubjectRepository,
  CourseSubjectView,
  CreateCourseSubjectData,
  SubjectRepository,
} from "../domain/types";

export interface CreateCourseSubjectInput {
  actor: AuthenticatedUser;
  data: CreateCourseSubjectData;
}

/** Enlaza una asignatura a un curso de la institución (ADMIN). §3.2 */
export class CreateCourseSubject implements UseCase<CreateCourseSubjectInput, CourseSubject> {
  constructor(
    private readonly courseSubjects: CourseSubjectRepository,
    private readonly courses: CourseRepository,
    private readonly subjects: SubjectRepository,
  ) {}

  async execute({ actor, data }: CreateCourseSubjectInput): Promise<Result<CourseSubject>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    const course = await this.courses.findById(actor.institutionId, data.courseId);
    if (!course) return fail(new ValidationError("El curso no existe en tu institución."));

    const subject = await this.subjects.findById(data.subjectId);
    const visible =
      subject && (subject.institutionId === null || subject.institutionId === actor.institutionId);
    if (!visible)
      return fail(
        new ValidationError("La asignatura no existe o no es visible para tu institución."),
      );

    if (await this.courseSubjects.exists(data.courseId, data.subjectId)) {
      return fail(new ValidationError("Esa asignatura ya está enlazada a ese curso."));
    }

    return ok(await this.courseSubjects.create(data));
  }
}

export interface ListCourseSubjectsInput {
  actor: AuthenticatedUser;
}

export class ListCourseSubjects implements UseCase<ListCourseSubjectsInput, CourseSubjectView[]> {
  constructor(private readonly courseSubjects: CourseSubjectRepository) {}

  async execute({ actor }: ListCourseSubjectsInput): Promise<Result<CourseSubjectView[]>> {
    const authorized = requireRole(actor, "ECU_MASTER", "COORDINATOR", "TEACHER");
    if (!authorized.ok) return authorized;
    return ok(await this.courseSubjects.findAll(actor.institutionId));
  }
}
