import { type AuthenticatedUser } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { NotFoundError, type Result, fail, ok } from "@/shared/domain/result";
import type { BundleDetail, BundleRepository } from "../domain/bundle";

export interface GetBundleInput {
  actor: AuthenticatedUser;
  bundleId: string;
}

/** Devuelve el bundle con sus items + totalQuestions agregado. */
export class GetBundle implements UseCase<GetBundleInput, BundleDetail> {
  constructor(private readonly bundles: BundleRepository) {}

  async execute({ actor, bundleId }: GetBundleInput): Promise<Result<BundleDetail>> {
    const bundle = await this.bundles.findDetail(actor.institutionId, bundleId);
    if (!bundle) return fail(new NotFoundError("Cuadernillo", bundleId));
    return ok(bundle);
  }
}
