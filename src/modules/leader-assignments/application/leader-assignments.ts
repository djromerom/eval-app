import {
  type AuthenticatedUser,
  requireRole,
  hasRole,
} from "@/shared/application/authenticated-user";
import { type UseCase } from "@/shared/application/use-case";
import { type Result, fail, ok } from "@/shared/domain/result";
import { DomainError, ValidationError } from "@/shared/domain/result";
import type { CourseRepository } from "@/modules/academic/domain/types";
import type { LeaderAssignment, LeaderAssignmentRepository } from "../domain/leader-assignment";

export interface AssignLeaderInput {
  actor: AuthenticatedUser;
  userId: string;
  courseId: string;
}

/** Asigna un usuario con rol ECU_LIDER a un curso entero de la institución. */
export class AssignLeader implements UseCase<AssignLeaderInput, void> {
  constructor(
    private readonly assignments: LeaderAssignmentRepository,
    private readonly courses: CourseRepository,
    /** Cómo verificar que el usuario objetivo tiene rol ECU_LIDER. Inyectado
     *  para no importar el módulo users aquí y mantener la hexagonal limpia. */
    private readonly userHasEcuLiderRole: (
      institutionId: string,
      userId: string,
    ) => Promise<boolean>,
  ) {}

  async execute({ actor, userId, courseId }: AssignLeaderInput): Promise<Result<void>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    const course = await this.courses.findById(actor.institutionId, courseId);
    if (!course) {
      return fail(new ValidationError("El grado no existe en tu institución."));
    }
    if (!(await this.userHasEcuLiderRole(actor.institutionId, userId))) {
      return fail(new ValidationError("El usuario no tiene rol Líder ECU en esta institución."));
    }
    if (await this.assignments.isAssigned(userId, courseId)) {
      return fail(new ValidationError("El líder ya está asignado a ese grado."));
    }
    await this.assignments.assign(userId, courseId);
    return ok(undefined);
  }
}

export interface UnassignLeaderInput {
  actor: AuthenticatedUser;
  userId: string;
  courseId: string;
}

/** Quita la asignación de un líder a un curso. Idempotente. */
export class UnassignLeader implements UseCase<UnassignLeaderInput, void> {
  constructor(private readonly assignments: LeaderAssignmentRepository) {}

  async execute({ actor, userId, courseId }: UnassignLeaderInput): Promise<Result<void>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;
    await this.assignments.unassign(userId, courseId);
    return ok(undefined);
  }
}

export interface ListLeaderAssignmentsInput {
  actor: AuthenticatedUser;
  userId?: string;
}

/**
 * Lista las asignaciones de la institución. Reglas:
 * - ECU_MASTER ve todas (o filtradas por userId si lo pasa).
 * - ECU_LIDER solo ve las suyas (se ignora el userId y se fuerza al suyo).
 */
export class ListLeaderAssignments implements UseCase<
  ListLeaderAssignmentsInput,
  LeaderAssignment[]
> {
  constructor(private readonly assignments: LeaderAssignmentRepository) {}

  async execute({
    actor,
    userId,
  }: ListLeaderAssignmentsInput): Promise<Result<LeaderAssignment[]>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    // Un líder no puede enumerar las asignaciones de OTRO líder.
    if (hasRole(actor, "ECU_LIDER") && !hasRole(actor, "ECU_MASTER")) {
      if (userId && userId !== actor.userId) {
        return fail(new DomainError("FORBIDDEN", "Solo puedes ver tus propias asignaciones."));
      }
      return ok(await this.assignments.listAssignments(actor.institutionId, actor.userId));
    }
    return ok(await this.assignments.listAssignments(actor.institutionId, userId));
  }
}
