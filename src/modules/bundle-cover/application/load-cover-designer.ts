/**
 * Caso de uso: cargar todo lo que la UI del designer necesita en una sola
 * llamada.
 *
 * Retorna:
 *   • state          — key efectiva, source, hasOverride, updatedAt.
 *   • editorBody     — HTML a mostrar en Monaco. Si hay override, ese; si
 *                      no, el built-in de la key actual (así el docente
 *                      siempre ve un punto de partida editable).
 *   • availableKeys  — lista de variantes que el dropdown debe ofrecer
 *                      (las que tienen built-in en FS).
 *   • builtinBody    — HTML del built-in puro (sin override). Útil para
 *                      mostrar como referencia cuando hay override.
 *
 * Permisos: manage-bundles (ECU_MASTER / ECU_LIDER).
 */
import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import { type UseCase } from "@/shared/application/use-case";
import { type Result, ok } from "@/shared/domain/result";
import {
  type CoverTemplateKey,
  type CoverTemplateLoader,
  type CoverTemplateRepository,
  type CoverTemplateState,
} from "../domain/cover-template";

export interface LoadCoverDesignerInput {
  actor: AuthenticatedUser;
  bundleId: string;
}

export interface CoverDesignerData {
  state: CoverTemplateState;
  /** Body a editar: built-in si source=BUILT_IN, override si source=OVERRIDE. */
  editorBody: string;
  /** Built-in puro, para mostrar como referencia. */
  builtinBody: string;
  /** Variantes disponibles (para el dropdown). */
  availableKeys: CoverTemplateKey[];
}

export class LoadCoverDesigner implements UseCase<LoadCoverDesignerInput, CoverDesignerData> {
  constructor(
    private readonly states: CoverTemplateRepository,
    private readonly loader: CoverTemplateLoader,
  ) {}

  async execute({ actor, bundleId }: LoadCoverDesignerInput): Promise<Result<CoverDesignerData>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    const state = await this.states.loadState(actor.institutionId, bundleId);
    const builtinBody = await this.loader.loadBuiltIn(state.key);

    // Si hay override, el editor muestra el override; si no, el built-in
    // (es el punto de partida natural para editar).
    let editorBody: string;
    if (state.source === "OVERRIDE") {
      const override = await this.states.loadBody(actor.institutionId, bundleId);
      editorBody = override ?? builtinBody;
    } else {
      editorBody = builtinBody;
    }

    const availableKeys = await this.loader.listAvailableKeys();

    return ok({ state, editorBody, builtinBody, availableKeys });
  }
}
