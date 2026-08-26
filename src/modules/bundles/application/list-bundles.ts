import { type AuthenticatedUser, hasRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ok } from "@/shared/domain/result";
import type { LeaderAssignmentRepository } from "@/modules/leader-assignments/domain/leader-assignment";
import type { Bundle, BundleRepository } from "../domain/bundle";

export interface ListBundlesInput {
  actor: AuthenticatedUser;
}

/**
 * Lista los bundles visibles para el actor.
 * - ECU_MASTER / SUPER_ADMIN → todos los de la institución.
 * - ECU_LIDER → solo los de los cursos que lidera (courseId ∈ asignados);
 *   los bundles cross-course (courseId null) NO se incluyen.
 * - TEACHER → todos los de la institución (read-only por capacidad).
 */
export class ListBundles implements UseCase<ListBundlesInput, Bundle[]> {
  constructor(
    private readonly bundles: BundleRepository,
    private readonly leaderAssignments: LeaderAssignmentRepository,
  ) {}

  async execute({ actor }: ListBundlesInput): Promise<Result<Bundle[]>> {
    if (hasRole(actor, "ECU_LIDER") && !hasRole(actor, "ECU_MASTER")) {
      const courseIds = await this.leaderAssignments.listAssignedCourseIds(
        actor.institutionId,
        actor.userId,
      );
      return ok(await this.bundles.findByCourseIds(actor.institutionId, courseIds));
    }
    return ok(await this.bundles.findAll(actor.institutionId));
  }
}
