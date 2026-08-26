import { PrismaBundleRepository } from "@/modules/bundles/infrastructure/prisma-bundle-repository";
import { makeUpdateBundleTheme } from "@/modules/bundles/infrastructure/container";
import { PrismaCoverLiveRepository } from "@/modules/cover-html/infrastructure/prisma-cover-html-repository";
import { RenderCoverHtml } from "@/modules/cover-html/application/render-cover-html";
import { PrismaInstitutionRepository } from "@/modules/institutions/infrastructure/prisma-institution-repository";
import { localStorage } from "@/shared/infrastructure/storage/local-storage";
import { BuildCoverContext } from "../application/cover-context";
import { ChangeCoverTemplateKey } from "../application/change-cover-template-key";
import { getResolvedCoverContent } from "../application/get-resolved-cover-content";
import { LoadCoverDesigner } from "../application/load-cover-designer";
import { LoadCoverStudio } from "../application/load-cover-studio";
import { PreviewCover } from "../application/preview-cover";
import { RenderCover } from "../application/render-cover";
import { ResetCoverTemplate } from "../application/reset-cover-template";
import { SaveCoverStudio } from "../application/save-cover-studio";
import { SaveCoverTemplate } from "../application/save-cover-template";
import { UpdateBundleCoverContent } from "../application/update-bundle-cover-content";
import { UpdateInstitutionCoverContent } from "../application/update-institution-cover-content";
import { FsCoverTemplateLoader } from "./fs-cover-template-loader";
import { LocalCoverAssetResolver } from "./local-cover-asset-resolver";
import { PrismaCoverTemplateRepository } from "./prisma-cover-template-repository";

/**
 * Composition root del módulo bundle-cover.
 *
 * Cablea los puertos del dominio (CoverTemplateRepository, CoverLiveRepository,
 * CoverTemplateLoader) con sus adaptadores concretos y construye los use cases
 * como factorías `makeXxx()` que la presentación importa. La presentación NUNCA
 * importa directamente los adaptadores — solo los use cases vía estas factorías.
 */
const states = new PrismaCoverTemplateRepository();
const liveStates = new PrismaCoverLiveRepository();
const loader = new FsCoverTemplateLoader();
const bundles = new PrismaBundleRepository();
const institutions = new PrismaInstitutionRepository();
const coverAssets = new LocalCoverAssetResolver(localStorage);

// --- Sub-composición: use cases sin estado ---
// `getResolvedCoverContent` lee `Institution.coverContent` +
// `EvaluationBundle.coverContent` directo de Prisma y los colapsa con los
// DEFAULT_* exportados por cover-defaults.ts. Se inyecta en BuildCoverContext
// para que el preview del cover-designer refleje overrides reales desde
// PR 2 en adelante.
const buildContext = new BuildCoverContext(bundles, institutions, getResolvedCoverContent);
const renderCover = new RenderCover();
// `cover-html` 4ª vista (ago 2026): el HTML live es la fuente de mayor
// precedencia (live → HTML → built-in). RenderCoverHtml es un
// thin wrapper sobre RenderCover — pasa el HTML por Mustache + DOMPurify
// sin walker (ya es string HTML completo).
const renderCoverHtml = new RenderCoverHtml(renderCover);

// --- Use cases de write del contenido de portada (PR 3, ago 2026) ---
// UpdateInstitutionCoverContent delega en InstitutionRepository.setCoverContent
// (la capa application/ no importa Prisma por regla del ESLint config).
const updateInstitutionCoverContent = new UpdateInstitutionCoverContent(institutions);
const updateBundleCoverContent = new UpdateBundleCoverContent(bundles);

// --- Use cases públicos ---
export const makePreviewCover = () =>
  new PreviewCover(
    states,
    liveStates,
    loader,
    buildContext,
    renderCover,
    renderCoverHtml,
    coverAssets,
    // Inyectado para `inlineHtmlImages` — convierte los `<img
    // src="/api/uploads/...">` de SVGs extraídos a data URLs en el render.
    localStorage.read,
  );

export const makeLoadCoverDesigner = () => new LoadCoverDesigner(states, loader);

export const makeSaveCoverTemplate = () => new SaveCoverTemplate(states);

export const makeResetCoverTemplate = () => new ResetCoverTemplate(states);

export const makeChangeCoverTemplateKey = () =>
  new ChangeCoverTemplateKey(states, async (key) => {
    const keys = await loader.listAvailableKeys();
    return keys.includes(key);
  });

export const makeUpdateBundleCoverContent = () => updateBundleCoverContent;

export const makeUpdateInstitutionCoverContent = () => updateInstitutionCoverContent;

// --- Cover Studio (ago 2026): flujo sincrónico de estilos + contenido + toggles.
export const makeLoadCoverStudio = () => new LoadCoverStudio({ states, loader });

export const makeSaveCoverStudio = () =>
  new SaveCoverStudio({
    states,
    loader,
    updateBundleTheme: makeUpdateBundleTheme(),
    updateBundleCoverContent,
    saveCoverTemplate: new SaveCoverTemplate(states),
  });
