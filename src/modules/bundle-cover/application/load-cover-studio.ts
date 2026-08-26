/**
 * Caso de uso: cargar todo lo que la UI del Cover Studio necesita.
 * ================================================================
 *
 * Reutiliza el dominio de `LoadCoverDesigner` (mismo shape, mismas llaves)
 * y le añade `blockState` — visibilidad efectiva de cada bloque del
 * Studio (`identifyActiveBlocks(editorBody)`).
 *
 * El Studio NO tiene editor de HTML crudo ni dropdown de variante: el
 * docente ya escribió el HTML en `/cover-designer` (paso previo). El
 * Studio se limita a aplicar estilos (theme), contenido (coverContent) y
 * toggles de bloques sobre el HTML existente.
 *
 * Permisos: manage-bundles (ECU_MASTER / ECU_LIDER).
 */
import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import { type UseCase } from "@/shared/application/use-case";
import { type Result, ok } from "@/shared/domain/result";
import { type CoverDesignerData } from "./load-cover-designer";
import { identifyActiveBlocks, type StudioBlockState } from "../domain/block-sections";

export interface LoadCoverStudioInput {
  actor: AuthenticatedUser;
  bundleId: string;
}

export interface CoverStudioData extends CoverDesignerData {
  /** Estado inicial de los checkboxes del Studio. */
  blockState: StudioBlockState;
}

export class LoadCoverStudio implements UseCase<LoadCoverStudioInput, CoverStudioData> {
  constructor(
    private readonly deps: {
      states: import("../domain/cover-template").CoverTemplateRepository;
      loader: import("../domain/cover-template").CoverTemplateLoader;
    },
  ) {}

  async execute({ actor, bundleId }: LoadCoverStudioInput): Promise<Result<CoverStudioData>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    const state = await this.deps.states.loadState(actor.institutionId, bundleId);
    const builtinBody = await this.deps.loader.loadBuiltIn(state.key);
    let editorBody: string;
    if (state.source === "OVERRIDE") {
      const override = await this.deps.states.loadBody(actor.institutionId, bundleId);
      editorBody = override ?? builtinBody;
    } else {
      editorBody = builtinBody;
    }
    const availableKeys = await this.deps.loader.listAvailableKeys();

    const blockState = identifyActiveBlocks(editorBody);
    return ok({ state, editorBody, builtinBody, availableKeys, blockState });
  }
}
