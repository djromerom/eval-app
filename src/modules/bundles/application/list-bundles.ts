import { type AuthenticatedUser, hasRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ok } from "@/shared/domain/result";
import type { LeaderAssignmentRepository } from "@/modules/leader-assignments/domain/leader-assignment";
import type { Bundle, BundleFilters, BundleRepository } from "../domain/bundle";

export interface ListBundlesInput {
  actor: AuthenticatedUser;
  /** Sprint Bundle-Period: filtros por Prueba / Tipo / Estado. Opcional —
   *  si no se pasan, se devuelven todos los bundles visibles al actor. */
  filters?: BundleFilters;
}

/**
 * Lista los bundles visibles para el actor.
 * - ECU_MASTER / SUPER_ADMIN → todos los de la institución.
 * - ECU_LIDER → solo los de los cursos que lidera (courseId ∈ asignados);
 *   los bundles cross-course (courseId null) NO se incluyen.
 * - TEACHER → todos los de la institución (read-only por capacidad).
 *
 * Los filtros (periodId/bookletTypeId/status) se aplican DESPUÉS del scope
 * por rol — solo refinan el resultado del scope, nunca lo reemplazan.
 * Para ECU_LIDER con filtros, los filtros se cruzan con los courseIds del
 * scope (intersección: courseId ∈ asignados ∧ matchea filtros).
 */
export class ListBundles implements UseCase<ListBundlesInput, Bundle[]> {
  constructor(
    private readonly bundles: BundleRepository,
    private readonly leaderAssignments: LeaderAssignmentRepository,
  ) {}

  async execute({ actor, filters }: ListBundlesInput): Promise<Result<Bundle[]>> {
    if (hasRole(actor, "ECU_LIDER") && !hasRole(actor, "ECU_MASTER")) {
      const courseIds = await this.leaderAssignments.listAssignedCourseIds(
        actor.institutionId,
        actor.userId,
      );
      if (courseIds.length === 0) return ok([]);
      // El scope del ECU_LIDER se aplica como filtro extra (AND): un bundle
      // debe (1) pertenecer a uno de sus cursos Y (2) matchear los filtros.
      // Si periodId/bookletTypeId vienen pero el líder no tiene cursos
      // asignados, ya filtramos arriba a []. Para mantener el filtro por
      // curso + los filtros por Prueba/Tipo, hacemos findAll(filters) y
      // filtramos en memoria por courseId.
      const all = await this.bundles.findAll(actor.institutionId, filters);
      const courseIdSet = new Set(courseIds);
      return ok(all.filter((b) => b.courseId !== null && courseIdSet.has(b.courseId)));
    }
    return ok(await this.bundles.findAll(actor.institutionId, filters));
  }
}
