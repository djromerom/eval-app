/**
 * Composition root del módulo `cover-html` (ago 2026).
 * =====================================================
 *
 * Cablea el puerto `CoverLiveRepository` (domain) con su adaptador Prisma
 * y construye los 4 use cases como factorías `makeXxx()` que la presentación
 * importa.
 *
 * El módulo NO tiene su propio `RenderCover` ni `BuildCoverContext` — los
 * reutiliza de `bundle-cover/` para mantener una sola fuente de verdad
 * para Mustache substitution + DOMPurify.
 *
 * La rama del live se INYECTA en `bundle-cover/application/preview-cover.ts`
 * (el composition root del preview) desde el container padre de
 * `bundle-cover/`. Acá solo exportamos los factories que la presentación
 * necesita para las páginas `/admin/bundles/[id]/cover-html/*`.
 */

import { PrismaBundleRepository } from "@/modules/bundles/infrastructure/prisma-bundle-repository";
import { RenderCover } from "@/modules/bundle-cover/application/render-cover";
import { LoadCoverHtml } from "../application/load-cover-html";
import { ResetCoverHtml } from "../application/reset-cover-html";
import { RenderCoverHtml } from "../application/render-cover-html";
import { SaveCoverHtml } from "../application/save-cover-html";
import { PrismaCoverLiveRepository } from "./prisma-cover-html-repository";

const liveStates = new PrismaCoverLiveRepository();
const bundles = new PrismaBundleRepository();

// Instancia compartida de RenderCover — la mantiene el container padre de
// bundle-cover. Acá la creamos para no importar el container padre (rompería
// la convención de "cada módulo tiene su container"). Es la misma clase;
// la instanciación es stateless.
const renderCover = new RenderCover();

const renderCoverHtml = new RenderCoverHtml(renderCover);

export const makeLoadCoverHtml = () => new LoadCoverHtml(liveStates);

export const makeSaveCoverHtml = () =>
  new SaveCoverHtml({
    liveStates,
    bundles,
  });

export const makeResetCoverHtml = () =>
  new ResetCoverHtml({
    liveStates,
    bundles,
  });

// Factory del render use case. Lo consume `bundle-cover/container.ts`
// para inyectarlo en `PreviewCover` y armar la cadena de precedencia
// (live → visual → HTML → built-in).
export const makeRenderCoverHtml = () => renderCoverHtml;
