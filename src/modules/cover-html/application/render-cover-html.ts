/**
 * Caso de uso: renderizar la portada desde el HTML live (4ª vista).
 * =================================================================
 *
 * Pipeline:
 *   1. El HTML live YA es un string completo — se pasa tal cual al
 *      `RenderCover` existente.
 *   2. `RenderCover.execute({ template, context, key, source: "BUILT_IN" })` —
 *      mismo use case que usan /cover-designer y /cover-studio. Hace
 *      Mustache substitution + DOMPurify.
 *
 * ## Por qué un use case separado (no reutilizar RenderCover directo)
 *
 * Para mantener `PreviewCover` como composition root que decide la
 * precedencia. Aquí NO hay lógica de transformación — solo un wrapper
 * thin para que el `PreviewCover` pueda llamar a algo con la misma forma
 * que `RenderCover`.
 *
 * ## Precedencia
 *
 * La rama del live vive en `PreviewCover` (que decide cuándo llamar a
 * este use case). `RenderCoverHtml` NO sabe nada de precedencia.
 *
 * ## Errores
 *
 * • `UnsafeCoverTemplateError` — DOMPurify removió demasiado y dejó el
 *   documento vacío. Mapeo a HTTP 422.
 */
import { type Result, fail, ok } from "@/shared/domain/result";
import {
  UnsafeCoverTemplateError,
  type CoverTemplateKey,
  type RenderedCover,
} from "@/modules/bundle-cover/domain/cover-template";
import { type CoverLiveProject } from "../domain/cover-html";
import { type CoverContext } from "@/modules/bundle-cover/application/cover-context";
import { RenderCover } from "@/modules/bundle-cover/application/render-cover";

export interface RenderCoverHtmlInput {
  /** HTML completo (ya validado por el use case que llama). */
  project: CoverLiveProject;
  /** Contexto Mustache producido por `BuildCoverContext`. */
  context: CoverContext;
  /** Key efectiva de la plantilla — se reporta en `RenderedCover`. */
  fallbackKey: CoverTemplateKey;
}

/**
 * Caso de uso `RenderCoverHtml`. Pasa el HTML live por el mismo pipeline
 * de Mustache + DOMPurify que el resto de las vistas.
 *
 * Stateless — no inyecta nada más que el `RenderCover` que ya existe.
 */
export class RenderCoverHtml {
  constructor(private readonly render: RenderCover) {}

  execute({ project, context, fallbackKey }: RenderCoverHtmlInput): Result<RenderedCover> {
    try {
      const rendered = this.render.execute({
        template: project.html,
        context,
        key: fallbackKey,
        // El HTML live no es "override HTML" (Monaco) — es una fuente paralela.
        source: "BUILT_IN",
      });
      return ok(rendered);
    } catch (err) {
      if (err instanceof UnsafeCoverTemplateError) {
        return fail(err);
      }
      throw err;
    }
  }
}
