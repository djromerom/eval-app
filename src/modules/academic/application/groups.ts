import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, NotFoundError, ValidationError, fail, ok } from "@/shared/domain/result";
import type { StudentRepository } from "@/modules/students/domain/student";
import {
  type CourseRepository,
  type CreateGroupData,
  type Group,
  type GroupRepository,
} from "../domain/types";

export interface CreateGroupInput {
  actor: AuthenticatedUser;
  data: CreateGroupData;
}

/** Crea un grupo (ej. "11-03") ligado a un curso de la institución (ADMIN). */
export class CreateGroup implements UseCase<CreateGroupInput, Group> {
  constructor(
    private readonly groups: GroupRepository,
    private readonly courses: CourseRepository,
  ) {}

  async execute({ actor, data }: CreateGroupInput): Promise<Result<Group>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    if (!data.name.trim()) return fail(new ValidationError("El nombre del grupo es obligatorio."));

    const course = await this.courses.findById(actor.institutionId, data.courseId);
    if (!course) {
      return fail(new ValidationError("El grado indicado no existe en tu institución."));
    }

    return ok(await this.groups.create(actor.institutionId, data));
  }
}

export interface ListGroupsInput {
  actor: AuthenticatedUser;
  courseId?: string;
}

export class ListGroups implements UseCase<ListGroupsInput, Group[]> {
  constructor(private readonly groups: GroupRepository) {}

  async execute({ actor, courseId }: ListGroupsInput): Promise<Result<Group[]>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;
    return ok(await this.groups.findAll(actor.institutionId, courseId));
  }
}

// ===== Delete (Fase 11 — card del curso) =====

export interface DeleteGroupInput {
  actor: AuthenticatedUser;
  groupId: string;
}

/**
 * Elimina un grupo. Solo `ECU_MASTER`. La pre-verificación con findById
 * garantiza que borramos algo que pertenece a la institución del actor
 * (un GROUP con id de otra institución es indistinguible de uno inexistente).
 *
 * Pre-check de estudiantes: si hay estudiantes asignados al grupo, el delete
 * se rechaza con ValidationError para evitar el P2003 que Prisma tira al
 * violar `Student_groupId_fkey`. Sin este check, el error sale como 500 del
 * server action en vez de un mensaje claro en `DeleteRowAction`.
 */
export class DeleteGroup implements UseCase<DeleteGroupInput, void> {
  constructor(
    private readonly groups: GroupRepository,
    private readonly students: StudentRepository,
  ) {}

  async execute({ actor, groupId }: DeleteGroupInput): Promise<Result<void>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    const current = await this.groups.findById(actor.institutionId, groupId);
    if (!current) return fail(new NotFoundError("Grupo", groupId));

    const enrolledStudents = await this.students.findByGroup(actor.institutionId, groupId);
    if (enrolledStudents.length > 0) {
      return fail(
        new ValidationError(
          `No se puede eliminar el grupo "${current.name}" porque tiene ${enrolledStudents.length} estudiante(s) asignado(s). Reasígnalos o desactívalos primero.`,
        ),
      );
    }

    await this.groups.delete(actor.institutionId, groupId);
    return ok(undefined);
  }
}
