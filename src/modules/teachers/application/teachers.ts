import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import { isValidEmail } from "@/modules/users/domain/user";
import type { CourseSubjectRepository } from "@/modules/academic/domain/types";
import {
  type CreateTeacherData,
  type Teacher,
  type TeacherAssignment,
  type TeacherRepository,
  isValidTeacherIdType,
} from "../domain/teacher";

export interface CreateTeacherInput {
  actor: AuthenticatedUser;
  data: CreateTeacherData;
}

/** Alta de docente: crea la cuenta (TEACHER, inactiva) + perfil (ADMIN). §3.2 */
export class CreateTeacher implements UseCase<CreateTeacherInput, Teacher> {
  constructor(private readonly teachers: TeacherRepository) {}

  async execute({ actor, data }: CreateTeacherInput): Promise<Result<Teacher>> {
    const authorized = requireRole(actor, "ADMIN");
    if (!authorized.ok) return authorized;

    if (!data.name.trim()) return fail(new ValidationError("El nombre es obligatorio."));
    if (!isValidEmail(data.email)) return fail(new ValidationError("Correo electrónico inválido."));
    if (!isValidTeacherIdType(data.idType)) {
      return fail(new ValidationError(`Tipo de documento inválido: "${data.idType}".`));
    }
    if (!data.idNumber.trim())
      return fail(new ValidationError("El número de documento es obligatorio."));

    return ok(
      await this.teachers.createWithUser(actor.institutionId, {
        ...data,
        email: data.email.toLowerCase(),
        name: data.name.trim(),
      }),
    );
  }
}

export interface ListTeachersInput {
  actor: AuthenticatedUser;
}

export class ListTeachers implements UseCase<ListTeachersInput, Teacher[]> {
  constructor(private readonly teachers: TeacherRepository) {}

  async execute({ actor }: ListTeachersInput): Promise<Result<Teacher[]>> {
    const authorized = requireRole(actor, "ADMIN");
    if (!authorized.ok) return authorized;
    return ok(await this.teachers.findAll(actor.institutionId));
  }
}

export interface AssignTeacherInput {
  actor: AuthenticatedUser;
  teacherId: string;
  courseSubjectId: string;
}

/** Asigna un docente a una asignatura-curso de la institución (ADMIN). §3.2 */
export class AssignTeacher implements UseCase<AssignTeacherInput, void> {
  constructor(
    private readonly teachers: TeacherRepository,
    private readonly courseSubjects: CourseSubjectRepository,
  ) {}

  async execute({ actor, teacherId, courseSubjectId }: AssignTeacherInput): Promise<Result<void>> {
    const authorized = requireRole(actor, "ADMIN");
    if (!authorized.ok) return authorized;

    const teacher = await this.teachers.findById(actor.institutionId, teacherId);
    if (!teacher) return fail(new ValidationError("El docente no existe en tu institución."));

    const courseSubject = await this.courseSubjects.findById(actor.institutionId, courseSubjectId);
    if (!courseSubject) {
      return fail(new ValidationError("La asignatura-curso no existe en tu institución."));
    }

    if (await this.teachers.isAssigned(teacherId, courseSubjectId)) {
      return fail(new ValidationError("El docente ya está asignado a esa asignatura-curso."));
    }

    await this.teachers.assign(teacherId, courseSubjectId);
    return ok(undefined);
  }
}

export interface ListTeacherAssignmentsInput {
  actor: AuthenticatedUser;
  teacherId?: string;
}

export class ListTeacherAssignments implements UseCase<
  ListTeacherAssignmentsInput,
  TeacherAssignment[]
> {
  constructor(private readonly teachers: TeacherRepository) {}

  async execute({
    actor,
    teacherId,
  }: ListTeacherAssignmentsInput): Promise<Result<TeacherAssignment[]>> {
    const authorized = requireRole(actor, "ADMIN", "TEACHER");
    if (!authorized.ok) return authorized;
    return ok(await this.teachers.listAssignments(actor.institutionId, teacherId));
  }
}
