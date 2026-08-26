/**
 * Caso de uso: persistir los cambios del Cover Studio en una sola pasada.
 * =======================================================================
 *
 * Orquesta TRES mutaciones que el docente dispara con un solo "Guardar
 * estilos":
 *
 *   1. `UpdateBundleTheme`     — color + fuente + densidad + columns + …
 *   2. `UpdateBundleCoverContent` — copy de portada (callout, itemsBefore…).
 *   3. `SaveCoverTemplate`     — HTML final con los bloques strippeados /
 *      restaurados según el estado de los toggles.
 *
 * Por qué un orquestador y no tres actions independientes:
 *   • El docente hace un solo click → una sola transacción visual.
 *   • El HTML strippeado depende de `builtinBody` (que NO está en el
 *     formData — el servidor lo carga desde disco).
 *   • Aplicar los tres cambios en serie permite que, si algo falla a mitad,
 *     los use cases anteriores ya persistidos se vean reflejados (cada uno
 *     es idempotente — el docente puede re-disparar la acción).
 *
 * Validación:
 *   • theme y coverContent vienen validados por sus use cases.
 *   • blockState: si llega un ID desconocido, se ignora silenciosamente
 *     (defensa contra form tampering).
 *
 * Permisos: manage-bundles (ECU_MASTER / ECU_LIDER).
 * Solo DRAFT: lo imponen `UpdateBundleTheme`, `UpdateBundleCoverContent`
 * y `SaveCoverTemplate` independientemente.
 */
import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import { type UseCase } from "@/shared/application/use-case";
import { type Result, ok } from "@/shared/domain/result";
import {
  applyBlockState,
  STUDIO_BLOCK_IDS,
  type StudioBlockId,
  type StudioBlockState,
} from "../domain/block-sections";
import type { CoverContent } from "../domain/cover-content";
import type {
  CoverTemplateLoader,
  CoverTemplateRepository,
  CoverTemplateState,
} from "../domain/cover-template";
import type { Bundle, BundleTheme } from "@/modules/bundles/domain/bundle";

export interface SaveCoverStudioInput {
  actor: AuthenticatedUser;
  bundleId: string;
  theme: Partial<BundleTheme>;
  coverContent: Partial<CoverContent>;
  /** Estado deseado por bloque. Faltantes caen al estado actual. */
  blockState: Partial<StudioBlockState>;
}

export interface SaveCoverStudioResult {
  /** Tema, contenido y HTML guardados correctamente. */
  state: CoverTemplateState;
}

export class SaveCoverStudio implements UseCase<SaveCoverStudioInput, SaveCoverStudioResult> {
  constructor(
    private readonly deps: {
      states: CoverTemplateRepository;
      loader: CoverTemplateLoader;
      updateBundleTheme: UseCase<
        {
          actor: AuthenticatedUser;
          bundleId: string;
          theme: Partial<BundleTheme>;
        },
        Bundle
      >;
      updateBundleCoverContent: UseCase<
        {
          actor: AuthenticatedUser;
          bundleId: string;
          coverContent: unknown | null;
        },
        Bundle
      >;
      saveCoverTemplate: UseCase<
        {
          actor: AuthenticatedUser;
          bundleId: string;
          body: string;
        },
        CoverTemplateState
      >;
    },
  ) {}

  async execute(input: SaveCoverStudioInput): Promise<Result<SaveCoverStudioResult>> {
    const authorized = requireRole(input.actor, "ECU_MASTER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    const { actor, bundleId, theme, coverContent, blockState } = input;

    // 1) Tema
    const themeResult = await this.deps.updateBundleTheme.execute({
      actor,
      bundleId,
      theme,
    });
    if (!themeResult.ok) return themeResult as Result<SaveCoverStudioResult>;

    // 2) Contenido de portada
    const contentResult = await this.deps.updateBundleCoverContent.execute({
      actor,
      bundleId,
      coverContent,
    });
    if (!contentResult.ok) return contentResult as Result<SaveCoverStudioResult>;

    // 3) HTML final con bloques togglados. Cargamos builtin + override
    //    actual del repo (no del formData) para tener la fuente de verdad.
    const currentState = await this.deps.states.loadState(actor.institutionId, bundleId);
    const builtinBody = await this.deps.loader.loadBuiltIn(currentState.key);
    const currentBody =
      currentState.source === "OVERRIDE"
        ? ((await this.deps.states.loadBody(actor.institutionId, bundleId)) ?? builtinBody)
        : builtinBody;

    // Sanitizar blockState: ignorar IDs desconocidos y rellenar ausentes con
    // el estado actual del HTML (mantener el bloque como está).
    const sanitizedState = sanitizeBlockState(blockState);

    // Aplicar el estado. Si no hay cambios en la estructura, el HTML no
    // cambia y podemos saltarnos `SaveCoverTemplate` (evita writes inútiles).
    const finalHtml = applyBlockState(currentBody, sanitizedState, builtinBody);

    if (finalHtml !== currentBody) {
      const saveResult = await this.deps.saveCoverTemplate.execute({
        actor,
        bundleId,
        body: finalHtml,
      });
      if (!saveResult.ok) return saveResult as Result<SaveCoverStudioResult>;
    }

    return ok({ state: currentState });
  }
}

/**
 * Construye un `StudioBlockState` completo a partir de un input parcial:
 * los IDs desconocidos se descartan, los ausentes se rellenan con `false`
 * (valor seguro — `applyBlockState` los dejará como están porque la
 * presencia efectiva se detecta leyendo el HTML, no del state).
 *
 * Devolver `false` para IDs ausentes es seguro porque `applyBlockState`
 * ya consulta `html.includes(STRIPPED_MARKER(id))` y la presencia real
 * del bloque antes de actuar.
 */
function sanitizeBlockState(partial: Partial<StudioBlockState>): StudioBlockState {
  const out = {} as StudioBlockState;
  for (const id of STUDIO_BLOCK_IDS) {
    const v = partial[id];
    if (typeof v === "boolean") {
      out[id] = v;
    } else {
      // Si el ID no viene en el form, asumimos false (NO tocamos el bloque).
      // `applyBlockState` lo dejará intacto porque `stripped` se chequea.
      out[id] = false;
    }
  }
  return out;
}

// Re-export para tests / callers que quieran inspeccionar el estado sanitizado.
export type _StudioBlockId = StudioBlockId;
