/**
 * Caso de uso: leer el estado del editor HTML Live de portada.
 * ============================================================
 *
 * Usado por `/admin/bundles/[id]/cover-html/page.tsx` (server component)
 * para inicializar el componente `<HtmlLiveEditor>` con el HTML persistido,
 * o con un editor vacío si nunca se editó.
 *
 * Devuelve AMBOS el state (metadata barata) y el project (HTML pesado) en
 * un solo round-trip al servidor.
 *
 * Permisos: manage-bundles (ECU_MASTER / ECU_LIDER).
 */
import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import { type UseCase } from "@/shared/application/use-case";
import { type Result, ok } from "@/shared/domain/result";
import {
  type CoverLiveProject,
  type CoverLiveRepository,
  type CoverLiveState,
} from "../domain/cover-html";

export interface LoadCoverHtmlInput {
  actor: AuthenticatedUser;
  bundleId: string;
}

export interface LoadCoverHtmlResult {
  state: CoverLiveState;
  /** HTML del proyecto listo para inyectar al iframe, o `null` si nunca
   *  se guardó (la UI del HTML Live debe iniciar con un editor vacío). */
  project: CoverLiveProject | null;
}

export class LoadCoverHtml implements UseCase<LoadCoverHtmlInput, LoadCoverHtmlResult> {
  constructor(private readonly liveStates: CoverLiveRepository) {}

  async execute({ actor, bundleId }: LoadCoverHtmlInput): Promise<Result<LoadCoverHtmlResult>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    const state = await this.liveStates.loadState(actor.institutionId, bundleId);
    const project = state.hasProject
      ? await this.liveStates.loadProject(actor.institutionId, bundleId)
      : null;

    return ok({ state, project });
  }
}
