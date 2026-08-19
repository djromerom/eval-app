import { type AuthenticatedUser } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ok } from "@/shared/domain/result";
import type { Bundle, BundleRepository } from "../domain/bundle";

export interface ListBundlesInput {
  actor: AuthenticatedUser;
}

/**
 * Lista los bundles de la institución del actor. Cualquier rol puede ver
 * (SUPER_ADMIN/TEACHER en read-only; ECU_MASTER y ECU_LIDER también editan
 * — el filtro por cursos asignados del líder se aplica aquí).
 */
export class ListBundles implements UseCase<ListBundlesInput, Bundle[]> {
  constructor(private readonly bundles: BundleRepository) {}

  async execute({ actor }: ListBundlesInput): Promise<Result<Bundle[]>> {
    const items = await this.bundles.findAll(actor.institutionId);
    return ok(items);
  }
}
