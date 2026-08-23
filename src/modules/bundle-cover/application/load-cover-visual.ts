/**
 * Caso de uso: leer el estado del editor visual de portada.
 * ==========================================================
 *
 * Usado por `/admin/bundles/[id]/cover-visual/page.tsx` (server component)
 * para inicializar el cliente GrapesJS con el JSON persistido, o con un
 * canvas vacío si nunca se editó.
 *
 * Devuelve AMBOS el state (metadata barata) y el project (JSON pesado) en
 * un solo round-trip al servidor — la UI del visual los necesita juntos
 * para mostrar "última edición", decidir si el visual está activo, y
 * cargar el proyecto en el editor.
 *
 * Permisos: manage-bundles (ECU_MASTER / ECU_LIDER) — mismo criterio que
 * el resto del módulo /admin/bundles.
 */
import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import { type UseCase } from "@/shared/application/use-case";
import { type Result, ok } from "@/shared/domain/result";
import {
  type CoverVisualProject,
  type CoverVisualRepository,
  type CoverVisualState,
} from "../domain/cover-visual";

export interface LoadCoverVisualInput {
  actor: AuthenticatedUser;
  bundleId: string;
}

export interface LoadCoverVisualResult {
  state: CoverVisualState;
  /** JSON del proyecto listo para `editor.load(project)`, o `null` si nunca
   *  se guardó (la UI del visual debe iniciar con un proyecto vacío por
   *  defecto). */
  project: CoverVisualProject | null;
}

export class LoadCoverVisual implements UseCase<LoadCoverVisualInput, LoadCoverVisualResult> {
  constructor(private readonly visualStates: CoverVisualRepository) {}

  async execute({ actor, bundleId }: LoadCoverVisualInput): Promise<Result<LoadCoverVisualResult>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    // El repo lanza NotFoundError si el bundle no existe en la institución;
    // dejamos que se propague — la capa de presentación lo traduce a 404.
    const state = await this.visualStates.loadState(actor.institutionId, bundleId);
    const project = state.hasProject
      ? await this.visualStates.loadProject(actor.institutionId, bundleId)
      : null;

    return ok({ state, project });
  }
}
