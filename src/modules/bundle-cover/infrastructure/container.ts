import { PrismaBundleRepository } from "@/modules/bundles/infrastructure/prisma-bundle-repository";
import { PrismaInstitutionRepository } from "@/modules/institutions/infrastructure/prisma-institution-repository";
import { localStorage } from "@/shared/infrastructure/storage/local-storage";
import { BuildCoverContext } from "../application/cover-context";
import { ChangeCoverTemplateKey } from "../application/change-cover-template-key";
import { getResolvedCoverContent } from "../application/get-resolved-cover-content";
import { LoadCoverDesigner } from "../application/load-cover-designer";
import { PreviewCover } from "../application/preview-cover";
import { RenderCover } from "../application/render-cover";
import { ResetCoverTemplate } from "../application/reset-cover-template";
import { SaveCoverTemplate } from "../application/save-cover-template";
import { FsCoverTemplateLoader } from "./fs-cover-template-loader";
import { LocalCoverAssetResolver } from "./local-cover-asset-resolver";
import { PrismaCoverTemplateRepository } from "./prisma-cover-template-repository";

/**
 * Composition root del módulo bundle-cover.
 *
 * Cablea los puertos del dominio (CoverTemplateRepository, CoverTemplateLoader)
 * con sus adaptadores concretos y construye los use cases como factorías
 * `makeXxx()` que la presentación importa. La presentación NUNCA importa
 * directamente los adaptadores — solo los use cases vía estas factorías.
 */
const states = new PrismaCoverTemplateRepository();
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

// --- Use cases públicos ---
export const makePreviewCover = () =>
  new PreviewCover(states, loader, buildContext, renderCover, coverAssets);

export const makeLoadCoverDesigner = () => new LoadCoverDesigner(states, loader);

export const makeSaveCoverTemplate = () => new SaveCoverTemplate(states);

export const makeResetCoverTemplate = () => new ResetCoverTemplate(states);

export const makeChangeCoverTemplateKey = () =>
  new ChangeCoverTemplateKey(states, async (key) => {
    const keys = await loader.listAvailableKeys();
    return keys.includes(key);
  });
