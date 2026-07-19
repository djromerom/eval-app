import { type AuthenticatedUser } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ok } from "@/shared/domain/result";
import type { Bundle, BundleRepository } from "../domain/bundle";

export interface ListBundlesInput {
  actor: AuthenticatedUser;
}

/**
 * Lista los bundles de la institución del actor. Cualquier rol puede ver
 * (ADMIN/COORDINATOR/TEACHER en read-only; SUPER_ADMIN también edita).
 */
export class ListBundles implements UseCase<ListBundlesInput, Bundle[]> {
  constructor(private readonly bundles: BundleRepository) {}

  async execute({ actor }: ListBundlesInput): Promise<Result<Bundle[]>> {
    const items = await this.bundles.findAll(actor.institutionId);
    return ok(items);
  }
}
