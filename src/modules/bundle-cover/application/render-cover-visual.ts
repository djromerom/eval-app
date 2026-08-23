/**
 * Caso de uso: renderizar la portada desde el proyecto visual (GrapesJS).
 * ========================================================================
 *
 * Pipeline:
 *   1. `serialiseProjectToHtml(project)` — walker puro en
 *      `domain/grapesjs-renderer.ts`. Devuelve HTML con markers
 *      `<!--STUDIO-BLOCK:ID:START/END-->` y/o secciones Mustache
 *      `{{#cover.X}}...{{/cover.X}}`.
 *   2. `RenderCover.execute({ template, context, key, source: "BUILT_IN" })` —
 *      mismo use case que usan `/cover-designer` y `/cover-studio`. Hace
 *      Mustache substitution + DOMPurify. El `source: "BUILT_IN"` es
 *      intencional: el proyecto visual NO es un "override" del HTML
 *      (es otra fuente). El caller puede distinguir visual de override
 *      mirando la presencia/ausencia de `coverVisualProject` en BD.
 *
 * ## Por qué un use case separado (no extender RenderCover)
 *
 * `RenderCover` mantiene su responsabilidad única: tomar un string HTML
 * crudo + contexto + key y devolver el HTML sanitizado. La conversión
 * JSON→HTML (el walker) es un concern aparte. Si la mezcláramos, RenderCover
 * necesitaría discriminar entre "input es string" y "input es proyecto
 * visual" — eso son dos code paths distintos en uno solo.
 *
 * ## Precedencia
 *
 * La rama del visual vive en `PreviewCover` (que decide cuándo llamar a
 * este use case). `RenderCoverVisual` NO sabe nada de precedencia — solo
 * renderiza lo que le llega. Si el visual está seteado, PreviewCover rutea
 * a este use case; si no, llama a `RenderCover` directamente.
 *
 * ## Errores
 *
 * • `MalformedCoverVisualError` — el walker detecta un type desconocido.
 *   Se mapea a HTTP 400 en el route handler.
 * • `UnsafeCoverTemplateError` — DOMPurify removió demasiado y dejó el
 *   documento vacío. Se mapea a HTTP 422.
 */
import { type Result, fail, ok } from "@/shared/domain/result";
import {
  UnsafeCoverTemplateError,
  type CoverTemplateKey,
  type RenderedCover,
} from "../domain/cover-template";
import { MalformedCoverVisualError, type CoverVisualProject } from "../domain/cover-visual";
import { serialiseProjectToHtml } from "../domain/grapesjs-renderer";
import { type CoverContext } from "./cover-context";
import { RenderCover } from "./render-cover";

export interface RenderCoverVisualInput {
  /** Proyecto GrapesJS (ya validado por el use case que llama). */
  project: CoverVisualProject;
  /** Contexto Mustache producido por `BuildCoverContext`. */
  context: CoverContext;
  /** Key efectiva de la plantilla HTML — se usa solo para reportar en
   *  el `RenderedCover` (el walker no la necesita). El visual cae al
   *  built-in/override de esta key al restablecerse. */
  fallbackKey: CoverTemplateKey;
}

/**
 * Caso de uso `RenderCoverVisual`. Su responsabilidad es serializar el
 * proyecto GrapesJS a HTML y pasarlo por el mismo pipeline de Mustache +
 * DOMPurify que el resto de las vistas.
 *
 * Stateless — no inyecta nada más que el `RenderCover` que ya existe.
 */
export class RenderCoverVisual {
  constructor(private readonly render: RenderCover) {}

  execute({ project, context, fallbackKey }: RenderCoverVisualInput): Result<RenderedCover> {
    let template: string;
    try {
      template = serialiseProjectToHtml(project);
    } catch (err) {
      if (err instanceof MalformedCoverVisualError) {
        return fail(err);
      }
      throw err;
    }

    try {
      const rendered = this.render.execute({
        template,
        context,
        key: fallbackKey,
        // El visual no es "override HTML" — es una fuente paralela.
        // Reportamos "BUILT_IN" porque semánticamente el proyecto visual
        // ocupa el lugar del HTML (sea override o no). La UI puede
        // distinguir visual vs HTML mirando `coverVisualProject` en BD.
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
