import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ValidationError, fail, ok } from "@/shared/domain/result";
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
    const authorized = requireRole(actor, "ADMIN");
    if (!authorized.ok) return authorized;

    if (!data.name.trim()) return fail(new ValidationError("El nombre del grupo es obligatorio."));

    const course = await this.courses.findById(actor.institutionId, data.courseId);
    if (!course) {
      return fail(new ValidationError("El curso indicado no existe en tu institución."));
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
    const authorized = requireRole(actor, "ADMIN");
    if (!authorized.ok) return authorized;
    return ok(await this.groups.findAll(actor.institutionId, courseId));
  }
}
