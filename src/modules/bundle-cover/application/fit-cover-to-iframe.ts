/**
 * Adaptador cover-HTML → iframe de impresión (ago 2026).
 * ======================================================
 *
 * Cuando el docente diseña una portada HTML live con anchos fijos en mm
 * (ej. `.cover { width: 215.9mm }` para una carta Letter completa), esa
 * geometría asume un `@page { margin: 0 }` propio. Al inyectar el HTML
 * dentro de un iframe en una página de impresión que ya respeta un
 * `@page { margin: 2cm }` del padre, el cover interno mide 215.9mm
 * (ancho de página completa) pero el iframe solo ofrece ~6.5in
 * (~165mm = área imprimible). El navegador centra el cover con
 * `margin: 0 auto` → franjas blancas grandes a izquierda y derecha.
 *
 * Este helper prepende un `<style>` de override al HTML del docente
 * que fuerza:
 *   - `--page-w` y `--page-h` a `100%` para que el cover fluya al
 *     tamaño del iframe en vez de las dimensiones fijas de página.
 *   - `body` y `html` sin margin/padding/background (la impresora
 *     ya respeta los márgenes del padre).
 *   - `.cover` al 100% del iframe, sin auto-margin ni overflow.
 *   - `@page { margin: 0 }` interno del HTML del docente neutralizado
 *     para que NO compita con el `@page` del padre.
 *
 * Los selectores usan `!important` solo donde hace falta pisar reglas
 * comunes del docente (`width`, `height`, `margin` del body/cover).
 * El resto de su CSS sigue funcionando — el `<style>` propio del
 * docente se carga después del override, así que sus selectores más
 * específicos ganan donde no entran en conflicto.
 *
 * El HTML ya pasó por DOMPurify (`RenderCover` con `WHOLE_DOCUMENT: true`),
 * así que añadir un `<style>` extra al `<head>` es seguro. El helper
 * es server-side puro — no toca DB, no toca Prisma, no hace fetch.
 */
const OVERRIDE_STYLE = `<style data-eval-app-iframe-fit>
  :root {
    --page-w: 100%;
    --page-h: 100%;
  }
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
    width: 100% !important;
    height: 100% !important;
    min-width: 0 !important;
  }
  .cover {
    width: 100% !important;
    height: 100% !important;
    margin: 0 !important;
    max-width: 100% !important;
    page-break-after: avoid !important;
    break-after: avoid !important;
  }
  @page {
    size: letter portrait;
    margin: 0 !important;
  }
</style>`;

/**
 * Inyecta el `<style>` de override en el `<head>` del HTML del docente.
 *
 * Si el HTML no tiene `<head>`, lo crea. Si ya tiene `<style>` propio
 * en el head, el override se prepende (queda ANTES), para que las
 * reglas del docente con selectores más específicos ganen donde
 * corresponda.
 *
 * Si el HTML ya trae un override previo (marcado con
 * `data-eval-app-iframe-fit`), NO lo duplica — pasa por alto.
 */
export function fitCoverToIframe(html: string): string {
  if (html.includes("data-eval-app-iframe-fit")) {
    return html;
  }

  // Si tiene <head>, inyectamos antes del primer hijo del head.
  const headOpenIdx = html.search(/<head[^>]*>/i);
  if (headOpenIdx >= 0) {
    const headEnd = headOpenIdx + html.slice(headOpenIdx).indexOf(">") + 1;
    return html.slice(0, headEnd) + OVERRIDE_STYLE + html.slice(headEnd);
  }

  // Si no tiene <head>, lo añadimos dentro de un <html> mínimo.
  // Cubre el caso de fragmentos sueltos (poco probable pero defensivo).
  const htmlOpenIdx = html.search(/<html[^>]*>/i);
  if (htmlOpenIdx >= 0) {
    const insertion = "<head>" + OVERRIDE_STYLE + "</head>";
    const htmlEnd = htmlOpenIdx + html.slice(htmlOpenIdx).indexOf(">") + 1;
    return html.slice(0, htmlEnd) + insertion + html.slice(htmlEnd);
  }

  // Sin <html> ni <head>: envolver y prepender el override.
  return `<html><head>${OVERRIDE_STYLE}</head><body>${html}</body></html>`;
}
