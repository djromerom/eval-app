import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, NotFoundError, ValidationError, fail, ok } from "@/shared/domain/result";
import type { TeacherRepository } from "@/modules/teachers/domain/teacher";
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

/**
 * Lista los enlaces asignatura-curso visibles para el actor:
 * - `ECU_MASTER` y `COORDINATOR`: todos los de la institución.
 * - `TEACHER`: solo los enlaces en los que está asignado (vía
 *   `TeacherSubjectAssignment`). Si el docente no tiene perfil o no tiene
 *   asignaciones, devuelve `[]`. Esto evita que un docente pueda crear
 *   formulaciones para asignaturas que no se le asignaron.
 *
 * Para resolver al docente desde la sesión usamos `teacherId = actor.userId`
 * → `teachers.findByUserId(institutionId, userId)`. La importación del repo
 * de docentes es **type-only** para mantener `academic` desacoplado a nivel
 * de runtime (el módulo `teachers` ya depende de tipos de `academic`).
 */
export class ListCourseSubjects implements UseCase<ListCourseSubjectsInput, CourseSubjectView[]> {
  constructor(
    private readonly courseSubjects: CourseSubjectRepository,
    private readonly teachers?: TeacherRepository,
  ) {}

  async execute({ actor }: ListCourseSubjectsInput): Promise<Result<CourseSubjectView[]>> {
    const authorized = requireRole(actor, "ECU_MASTER", "COORDINATOR", "TEACHER");
    if (!authorized.ok) return authorized;

    const all = await this.courseSubjects.findAll(actor.institutionId);

    // Los roles administrativos ven el listado completo.
    if (actor.roles.includes("ECU_MASTER") || actor.roles.includes("COORDINATOR")) {
      return ok(all);
    }

    // TEACHER: filtramos por las asignaciones del docente.
    if (!this.teachers) return ok([]);
    const teacher = await this.teachers.findByUserId(actor.institutionId, actor.userId);
    if (!teacher) return ok([]);

    const assignments = await this.teachers.listAssignments(actor.institutionId, teacher.id);
    const allowedIds = new Set(assignments.map((a) => a.courseSubjectId));
    return ok(all.filter((cs) => allowedIds.has(cs.id)));
  }
}

// ===== Delete (Fase 11 — card del curso) =====
export interface DeleteCourseSubjectInput {
  actor: AuthenticatedUser;
  courseSubjectId: string;
}

/**
 * Desenlaza una asignatura de un curso. Solo `ECU_MASTER`. La pre-verificación
 * vía findById (que filtra por institución vía course.institutionId) garantiza
 * que solo borramos enlaces de la institución del actor.
 */
export class DeleteCourseSubject implements UseCase<DeleteCourseSubjectInput, void> {
  constructor(
    private readonly courseSubjects: CourseSubjectRepository,
    private readonly courses: CourseRepository,
  ) {}

  async execute({ actor, courseSubjectId }: DeleteCourseSubjectInput): Promise<Result<void>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    const current = await this.courseSubjects.findById(actor.institutionId, courseSubjectId);
    if (!current) return fail(new NotFoundError("Asignatura enlazada", courseSubjectId));

    // findById no devolvió la PK compuesta, pero sabemos que current.courseId
    // existe en la institución por el filtro. Releemos la fila completa para
    // obtener subjectId y poder borrar por la constraint compuesta.
    // Truco barato: parseamos el id del CourseSubject (formato "courseId:subjectId"
    // — Prisma lo construye así cuando serializa); si no, hacemos un lookup.
    const all = await this.courseSubjects.findAll(actor.institutionId);
    const target = all.find((cs) => cs.id === courseSubjectId);
    if (!target) return fail(new NotFoundError("Asignatura enlazada", courseSubjectId));

    await this.courseSubjects.delete(target.courseId, target.subjectId);
    return ok(undefined);
  }
}
