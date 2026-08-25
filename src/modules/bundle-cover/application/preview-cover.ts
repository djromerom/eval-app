/**
 * Caso de uso: previsualizar la portada del bundle.
 *
 * Compone BuildCoverContext + (RenderCover | RenderCoverHtml) + (built-in
 * / override) en una sola llamada para que la UI del designer pueda pintar
 * el iframe de preview con un solo endpoint.
 *
 * Esta use case NO modifica nada — es lectura pura. La sanitización la
 * hace el render correspondiente: si la plantilla (built-in, override o
 * HTML live) tiene scripts / iframes / etc., el HTML resultante los
 * tiene removidos.
 *
 * ## Precedencia de fuentes (ago 2026)
 *
 * La cascada es `live → HTML → built-in`:
 *
 *   1. **HTML live** (`coverLiveProject`) — si está seteado. Es un
 *      string HTML completo producido por el editor HTML Live de
 *      `/cover-html`. Mayor precedencia.
 *   2. **Override HTML** (Monaco, `coverTemplateBody`) — si está seteado.
 *   3. **Built-in de la key** (default).
 *
 * Cada rama se implementa como un branch temprano: si la fuente N está
 * activa, nunca leemos las fuentes N+1..N+2.
 *
 * Adicionalmente, resuelve las imágenes referenciadas en el contexto
 * (`institution.logo`, `story.illustration`) — paths del FS tipo
 * `institutions/{id}/logo.png` — a data URLs inline. El iframe del preview
 * se carga vía `srcDoc` y NO tiene URL base, así que un `src` relativo no
 * resolvería. El PDF real (Puppeteer) sí tiene acceso al FS, pero acá
 * resolvemos siempre para mantener el comportamiento uniforme.
 *
 * Permisos: requiere manage-bundles (ECU_MASTER / ECU_LIDER) — misma
 * política que el resto del módulo /admin/bundles.
 */
import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import { type UseCase } from "@/shared/application/use-case";
import { type Result, fail, ok } from "@/shared/domain/result";
import {
  UnsafeCoverTemplateError,
  type CoverTemplateLoader,
  type CoverTemplateRepository,
  type CoverTemplateState,
  type RenderedCover,
} from "../domain/cover-template";
import { type CoverLiveRepository } from "@/modules/cover-html/domain/cover-html";
import { type CoverContext, BuildCoverContext } from "./cover-context";
import { RenderCover } from "./render-cover";
import { RenderCoverHtml } from "@/modules/cover-html/application/render-cover-html";
import { inlineHtmlImages } from "@/modules/cover-html/application/inline-html-images";
import { type ReadUpload } from "@/modules/cover-html/application/inline-html-images";

export interface PreviewCoverInput {
  actor: AuthenticatedUser;
  bundleId: string;
}

/**
 * Puerto para resolver un path de asset (relativo al STORAGE_DIR) a una
 * URL embebible en el iframe (`data:image/...;base64,...`). Devuelve `null`
 * si el path es null o si la lectura falla (asset borrado, etc.).
 */
export interface CoverAssetResolver {
  resolveToDataUrl(path: string | null): Promise<string | null>;
}

export class PreviewCover implements UseCase<PreviewCoverInput, RenderedCover> {
  constructor(
    private readonly states: CoverTemplateRepository,
    private readonly liveStates: CoverLiveRepository,
    private readonly loader: CoverTemplateLoader,
    private readonly buildContext: BuildCoverContext,
    private readonly render: RenderCover,
    private readonly renderCoverHtml: RenderCoverHtml,
    private readonly assets: CoverAssetResolver,
    /** Inyectado por el container — `localStorage.read` en prod, doble en tests. */
    private readonly readUpload: ReadUpload,
  ) {}

  async execute({ actor, bundleId }: PreviewCoverInput): Promise<Result<RenderedCover>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    // El repo lanza NotFoundError si el bundle no existe en la institución;
    // dejamos que se propague — la capa de presentación lo traduce a 404.
    const state = await this.states.loadState(actor.institutionId, bundleId);

    const contextRes = await this.buildContext.execute({ actor, bundleId });
    if (!contextRes.ok) return contextRes;

    // Resolver imágenes referenciadas en el contexto a data URLs antes
    // de renderizar. Si la resolución falla para algún asset, lo dejamos
    // como `null` — la plantilla secundaria-v1 cae al fallback de texto
    // (`<div class="logo-fallback">`) automáticamente.
    const decorated = await this.decorateAssets(contextRes.value);

    // --- PR 5 (ago 2026): branch del HTML live ---
    // El HTML live es la fuente de mayor precedencia: un string HTML
    // completo producido por el editor HTML Live de `/cover-html`. Si
    // está seteado, gana sobre el visual y el HTML override. La cascada
    // queda: live → visual → HTML → built-in.
    //
    // Cargamos el HTML solo si state.hasProject lo confirma (evitamos un
    // round-trip inútil si la columna es null). RenderCoverHtml pasa el
    // HTML por el mismo RenderCover (Mustache + DOMPurify) — NO hay
    // walker porque el live ya es un string HTML completo.
    const liveProject = await this.liveStates.loadProject(actor.institutionId, bundleId);
    if (liveProject) {
      const rendered = this.renderCoverHtml.execute({
        project: liveProject,
        context: decorated,
        fallbackKey: state.key,
      });
      if (!rendered.ok) return rendered;
      // Inlear los `<img src="/api/uploads/...">` que apuntan a SVGs
      // extraídos en el save. El iframe sandbox="" y el PDF de Puppeteer
      // no pueden hacer fetch a esas URLs sin autenticación — el data
      // URL inline las hace autocontenidas.
      const inlinedHtml = await inlineHtmlImages(rendered.value.html, {
        read: this.readUpload,
      });
      return ok({ ...rendered.value, html: inlinedHtml });
    }

    // --- Camino tradicional: built-in o HTML override ---
    const template = await this.resolveTemplate(actor, bundleId, state);

    try {
      const rendered = this.render.execute({
        template,
        context: decorated,
        key: state.key,
        source: state.source,
      });
      return ok(rendered);
    } catch (err) {
      // Render lanza UnsafeCoverTemplateError si la sanitización dejó el
      // documento vacío. Lo devolvemos como fail() para que la UI muestre
      // "contenido bloqueado por seguridad".
      if (err instanceof UnsafeCoverTemplateError) {
        return fail(err);
      }
      throw err;
    }
  }

  /** Construye una copia del contexto con `institution.logo` y
   *  `story.illustration` apuntando a data URLs inline. Si la lectura
   *  falla, conserva el path original (la plantilla tiene fallbacks). */
  private async decorateAssets(ctx: CoverContext): Promise<CoverContext> {
    const [logo, illustration] = await Promise.all([
      this.assets.resolveToDataUrl(ctx.institution.logo),
      this.assets.resolveToDataUrl(ctx.story.illustration),
    ]);
    return {
      ...ctx,
      institution: { ...ctx.institution, logo },
      story: { ...ctx.story, illustration },
    };
  }

  /** Resuelve el HTML efectivo según el estado: override si hay, si no
   *  el built-in de la key actual. */
  private async resolveTemplate(
    actor: AuthenticatedUser,
    bundleId: string,
    state: CoverTemplateState,
  ): Promise<string> {
    if (state.source === "OVERRIDE") {
      const body = await this.states.loadBody(actor.institutionId, bundleId);
      if (body) return body;
      // Inconsistencia: state dice OVERRIDE pero body es null. Caemos al
      // built-in y dejamos que la próxima invocación corrija el estado.
    }
    return this.loader.loadBuiltIn(state.key);
  }
}
