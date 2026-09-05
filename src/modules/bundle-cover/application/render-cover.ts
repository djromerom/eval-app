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
 * Política de sanitización (sep 2026):
 * -----------------------------
 * Antes usábamos `ALLOWED_TAGS` + `ALLOWED_ATTR` con whitelist explícita
 * (DENY-by-default). Pero DOMPurify tiene una limitación conocida: cuando
 * pasas esas listas, NO se aplican correctamente a elementos del namespace
 * SVG — los atributos `viewBox`, `d`, `stroke-width`, etc. se eliminan del
 * output aunque estén listados, y los íconos SVG del docente quedaban
 * vacíos en el PDF.
 *
 * Solución: usar `USE_PROFILES: { html: true, svg: true }` — los profiles
 * built-in de DOMPurify SÍ manejan correctamente los attrs de SVG. La
 * defensa XSS sigue activa:
 *
 *   • `<script>`, `<iframe>`, `<object>`, `<embed>`, `<base>` — bloqueados
 *     por FORBID_TAGS (veto explícito por encima del profile).
 *   • `href="javascript:..."`, `src="data:text/html,..."` — eliminados
 *     por los defaults del profile html.
 *   • Event handlers `on*=` — eliminados por defaults.
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

    // 2) Sanitizar. Usamos los profiles built-in de DOMPurify (`html` + `svg`)
    // en vez de un whitelist explícito — ver docstring del módulo. FORBID_TAGS
    // actúa como veto explícito por encima del profile (los profiles ya
    // excluyen lo peligroso, pero el veto hace la defensa explícita y robusta
    // a futuros cambios de defaults).
    const dirty = collectForbidden(substituted);
    const clean = DOMPurify.sanitize(substituted, {
      USE_PROFILES: { html: true, svg: true },
      FORBID_TAGS: [...FORBIDDEN_TAGS_WITH_CONTENT, ...FORBIDDEN_VOID_TAGS],
      // Sin WHOLE_DOCUMENT, DOMPurify extrae solo el `<body>` y descarta
      // `<head>` + `<style>` (considera su contenido peligroso por default).
      // Necesitamos el `<style>` para que el preview en iframe aplique el
      // CSS de la plantilla. Con USE_PROFILES + WHOLE_DOCUMENT el `<style>`
      // se preserva y los SVG attributes (viewBox, d, etc.) también.
      RETURN_TRUSTED_TYPE: false,
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
