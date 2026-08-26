/**
 * Inlea las imágenes referenciadas por `<img src="/api/uploads/...">`
 * dentro de un string HTML a data URLs (ago 2026).
 * ============================================================
 *
 * ## Por qué existe
 *
 * El cover HTML live persiste `<img src="/api/uploads/institutions/...svg">`
 * para SVGs extraídos en el save. Cuando ese HTML se inyecta al preview
 * iframe (`<iframe srcdoc sandbox="">`) o al PDF de Puppeteer, esas URLs
 * NO se resuelven:
 *
 *   • El iframe tiene `sandbox=""` (sin same-origin, sin red) — no puede
 *     hacer fetch a `/api/uploads/`.
 *
 *   • Puppeteer renderiza `/print/bundle/<id>?t=token` con sesión de
 *     service-account, pero los `<img>` son peticiones aparte sin token,
 *     y el endpoint exige auth de tenant — saldrían rotas.
 *
 * Solución: antes de inyectar, sustituimos esos src por `data:` URIs con
 * el contenido del archivo. Igual a lo que `inlineContentImages` hace
 * para documentos TipTap, pero para strings HTML.
 *
 * ## Diseño
 *
 * • Regex `<img\b[^>]*?\bsrc="([^"]+)"[^>]*>` — captura el src exacto.
 *   Cualquier src que NO arranque con `/api/uploads/` se deja intacto
 *   (URLs externas, data: URLs inline del usuario, paths relativos).
 *
 * • Cache por path: si el mismo SVG aparece 3 veces, leemos del disco
 *   una sola vez.
 *
 * • Walk por índices (no `replace` posicional) para evitar el bug de
 *   "primer match" cuando hay `<img>` tags idénticos repetidos.
 *
 * • Si un archivo falta en disco, conservamos el src original — mejor
 *   un examen con una imagen rota que ningún examen (mismo criterio
 *   que `inlineContentImages`).
 */
export type ReadUpload = (relativePath: string) => Promise<Buffer>;

export interface InlineHtmlImagesDeps {
  read: ReadUpload;
}

const IMG_PATTERN = /<img\b[^>]*?\bsrc="([^"]+)"[^>]*>/gi;
const UPLOADS_PREFIX = "/api/uploads/";

/** Devuelve el MIME type apropiado según la extensión del archivo. Cubre
 *  los formatos que `extractInlineAssets` puede guardar (ago 2026). */
function mimeForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

/**
 * Devuelve el HTML con los `<img src="/api/uploads/...">` sustituidos por
 * data URLs. Es idempotente: un HTML sin esas URLs pasa tal cual.
 */
export async function inlineHtmlImages(html: string, deps: InlineHtmlImagesDeps): Promise<string> {
  const matches = [...html.matchAll(IMG_PATTERN)];
  if (matches.length === 0) return html;

  // Cache por path para no leer el mismo archivo N veces.
  const cache = new Map<string, Promise<string | null>>();

  function dataUriFor(src: string): Promise<string | null> {
    if (!src.startsWith(UPLOADS_PREFIX)) return Promise.resolve(null);
    const relative = src.slice(UPLOADS_PREFIX.length);
    const hit = cache.get(relative);
    if (hit) return hit;
    const pending = deps
      .read(relative)
      .then((buf) => `data:${mimeForPath(relative)};base64,${buf.toString("base64")}`)
      .catch(() => null);
    cache.set(relative, pending);
    return pending;
  }

  // Pre-resolver todos los src únicos en paralelo.
  const uniqueSrcs = [...new Set(matches.map((m) => m[1]!))];
  const resolvedEntries = await Promise.all(
    uniqueSrcs.map(async (src) => [src, await dataUriFor(src)] as const),
  );
  const srcToDataUri = new Map(resolvedEntries);

  // Walk por índices (orden de aparición en HTML).
  let result = "";
  let lastEnd = 0;
  for (const m of matches) {
    const fullMatch = m[0];
    const src = m[1]!;
    const start = m.index ?? 0;

    result += html.slice(lastEnd, start);

    const dataUri = srcToDataUri.get(src);
    if (dataUri) {
      // Reemplazar SOLO el src dentro del tag. Si el src aparece más de
      // una vez dentro del mismo tag (raro pero legal), reemplazamos
      // solo la primera — `String.replace` sin `g` hace eso.
      result += fullMatch.replace(src, dataUri);
    } else {
      result += fullMatch;
    }
    lastEnd = start + fullMatch.length;
  }
  result += html.slice(lastEnd);

  return result;
}
