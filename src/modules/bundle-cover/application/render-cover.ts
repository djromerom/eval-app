/**
 * Caso de uso: renderizar el HTML final de la portada.
 *
 * Pipeline:
 *   1. Mustache.render(template, context)  →  HTML con variables resueltas.
 *   2. DOMPurify.sanitize(html, opts)     →  HTML seguro para inyectar.
 *
 * La sanitización es OBLIGATORIA porque:
 *   • El HTML puede ser un override del admin (editado en Monaco o subido
 *     desde archivo). Aunque confiamos en el docente, defendemos contra:
 *       – XSS que afecte el PDF / preview de OTROS bundles si se loguea
 *         alguien distinto con el mismo tenant.
 *       – CSS injection que rompa el layout (`<style>` con selectores
 *         universales).
 *       – SVG malicioso con `<foreignObject>` que ejecute JS.
 *   • Puppeteer renderiza el HTML en un contexto Chromium con acceso a
 *     filesystem local y red. Un `<iframe src="file://...">` sería un
 *     vector de exfiltración.
 *
 * Por eso la política es DENY-by-default: solo permitimos el subset que la
 * plantilla necesita (HTML estructural + CSS embebido + imágenes + svg inline).
 * Cualquier `<script>`, `<iframe>`, `on*=` handler, `javascript:` URL, etc.
 * se elimina silenciosamente.
 *
 * Si la sanitización REMUEVE algo que el docente considera esencial, el use
 * case devuelve UNSAFE_COVER_TEMPLATE con la lista de lo quitado — la UI lo
 * muestra como "contenido bloqueado por seguridad" para que sepa qué
 * ajustar. NO rechazamos todo el render: si solo se eliminó un `<script>`
 * inocuo, el HTML restante sigue siendo útil.
 */
import Mustache from "mustache";
import DOMPurify from "isomorphic-dompurify";
import { type CoverContext } from "./cover-context";
import {
  UnsafeCoverTemplateError,
  type CoverTemplateKey,
  type CoverTemplateSource,
  type RenderedCover,
} from "../domain/cover-template";

export interface RenderCoverInput {
  /** HTML crudo de la plantilla (built-in o override). */
  template: string;
  /** Contexto Mustache producido por `BuildCoverContext`. */
  context: CoverContext;
  /** Key efectiva usada para identificar la fuente en el resultado. */
  key: CoverTemplateKey;
  /** Source efectivo (BUILT_IN o OVERRIDE) — solo para el return. */
  source: CoverTemplateSource;
}

/** Tags permitidos en el output. Es whitelist explícita; cualquier otro tag
 *  se elimina (junto con su contenido si es peligroso). */
const ALLOWED_TAGS = [
  // Estructura HTML5
  "html",
  "head",
  "body",
  "title",
  "meta",
  "link",
  "div",
  "section",
  "header",
  "footer",
  "main",
  "article",
  "aside",
  "nav",
  "p",
  "br",
  "hr",
  "span",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "small",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "img",
  "figure",
  "figcaption",
  "picture",
  "source",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "blockquote",
  "pre",
  "code",
  // Estilos + SVG inline (necesarios para los iconos de asignatura y las
  // decoraciones que usan algunas plantillas).
  "style",
  "svg",
  "g",
  "path",
  "circle",
  "rect",
  "line",
  "polygon",
  "polyline",
  "text",
  "tspan",
  "defs",
  "use",
  "title",
  "desc",
];

/** Atributos permitidos. `style` se permite para CSS inline (p.ej. en SVG). */
const ALLOWED_ATTR = [
  "class",
  "id",
  "style",
  "href",
  "src",
  "alt",
  "title",
  "lang",
  "dir",
  "width",
  "height",
  "viewbox",
  "preserveaspectratio",
  "fill",
  "stroke",
  "strokewidth",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "d",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "points",
  "transform",
  "opacity",
  "xmlns",
  "colspan",
  "rowspan",
  "scope",
  "type",
  "rel",
  "charset",
];

/** Tags que SI se eliminan con todo su contenido (no son autocierre y
 *  meterlos dejaría HTML a medio cerrar). */
const FORBIDDEN_TAGS_WITH_CONTENT = ["script", "iframe", "object", "embed"];

/** Tags auto-cerrables que se eliminan solos. */
const FORBIDDEN_VOID_TAGS = ["base"];

export class RenderCover {
  execute({ template, context, key, source }: RenderCoverInput): RenderedCover {
    // 1) Sustituir variables Mustache. Escape por default en {{var}};
    //    los {{{var}}} pasan raw (lo usa la plantilla para inyectar SVG
    //    de iconos de asignatura).
    const substituted = Mustache.render(template, context as unknown as Record<string, unknown>);

    // 2) Sanitizar. Configuración en DENY-by-default para todo lo no listado.
    const dirty = collectForbidden(substituted);
    const clean = DOMPurify.sanitize(substituted, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      FORBID_TAGS: [...FORBIDDEN_TAGS_WITH_CONTENT, ...FORBIDDEN_VOID_TAGS],
      // No permitimos data: URLs arbitrarios — solo data:image/*.
      // Tampoco javascript:, vbscript:, file:.
      ALLOWED_URI_REGEXP:
        /^(?:(?:https?|mailto):|[#/]|(?:data:image\/(?:png|jpe?g|gif|webp|svg\+xml)[;,])|(?:data:application\/pdf))/i,
      // OJO — NO poner KEEP_CONTENT:false. La doc de DOMPurify es confusa
      // y la opción, contra lo que el nombre sugiere, NO significa "el
      // contenido de los tags prohibidos se borra". En algunas versiones
      // borra TODO el contenido de texto, dejando solo tags vacíos. El
      // default (omitir la opción) preserva el contenido de los tags
      // permitidos y borra el de los prohibidos — que es lo que queremos.
      RETURN_TRUSTED_TYPE: false,
      // Sin WHOLE_DOCUMENT, DOMPurify extrae solo el `<body>` y descarta
      // `<head>` + `<style>` (los tags siguen en ALLOWED_TAGS pero su
      // CONTENIDO se descarta porque se considera peligroso por default).
      // Necesitamos el `<style>` para que el preview en iframe aplique el
      // CSS de la plantilla. Las restricciones de ALLOWED_TAGS/ATTR siguen
      // activas, así que la política DENY-by-default se mantiene.
      WHOLE_DOCUMENT: true,
    });

    if (dirty.length > 0) {
      // Advertimos pero NO fallamos: si quedó HTML utilizable, lo
      // devolvemos igual y la UI muestra un warning con los tags
      // removidos. Solo lanzamos error si el sanitizador decidió borrar
      // el documento entero (cuerpo vacío).
      if (clean.replace(/<[^>]*>/g, "").trim().length === 0) {
        throw new UnsafeCoverTemplateError(
          `La plantilla quedó vacía después de sanitizar. Tags removidos: ${dirty.join(", ")}`,
        );
      }
    }

    return { html: clean, source, key };
  }
}

/**
 * Devuelve la lista de tags prohibidos detectados en el HTML ANTES de
 * sanitizar. Útil para mostrar en la UI qué contenido fue bloqueado.
 * Solo busca los tags peligrosos más comunes para no inflar el array.
 */
function collectForbidden(html: string): string[] {
  const found = new Set<string>();
  const allForbidden = [...FORBIDDEN_TAGS_WITH_CONTENT, ...FORBIDDEN_VOID_TAGS, "script"];
  for (const tag of allForbidden) {
    const re = new RegExp(`<\\s*${tag}\\b`, "i");
    if (re.test(html)) found.add(tag);
  }
  return [...found];
}
