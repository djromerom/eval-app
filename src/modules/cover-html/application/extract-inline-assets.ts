/**
 * Extrae imágenes inline (data URIs en `<img>`) de una portada HTML y las
 * guarda como archivos en disco (ago 2026, actualizado sep 2026).
 * ===============================================================
 *
 * ## Por qué existe
 *
 * Una portada con assets inline puede inflar el HTML hasta superar los
 * límites del use case (`MAX_COVER_LIVE_PROJECT_BYTES = 3MB`):
 *
 *   • `<img src="data:image/png;base64,...">` raster (fotos, decoraciones):
 *     base64 infla ~33% vs el archivo original; una foto de 100KB → ~130KB
 *     inline. 5 fotos → 650KB.
 *
 * Una portada de 1MB con imágenes es el caso REAL del docente (no
 * extremos teóricos). Extrayéndolos:
 *
 *   • El HTML persistido queda compacto (cada asset → un `<img>` corto).
 *   • Los assets viven en disco, referenciados por URL `/api/uploads/...`.
 *   • El render-time los inlinea a data URLs (vía `inlineHtmlImages`) para
 *     que el iframe sandbox="" y el PDF de Puppeteer los vean.
 *
 * ## Tipos soportados (sep 2026, después del fix A)
 *
 *   • Imágenes raster — match `<img src="data:image/<subtype>;base64,...">`
 *     donde subtype ∈ {png, jpg, jpeg, gif, webp, svg+xml}. Guarda como
 *     `.png`/`.jpg`/`.gif`/`.webp`/`.svg` (binario decodificado de base64).
 *
 * ## Por qué NO extraemos `<svg>` inline (sep 2026)
 *
 * El intent original era mover también los `<svg>...</svg>` vectoriales a
 * disco, reemplazándolos por `<img src="/api/uploads/...svg">`. Pero ese
 * reemplazo destruía atributos del `<svg>` (class, viewBox, fill, width,
 * height, role) → todos los íconos quedaban rotos visualmente al guardar.
 *
 * Decisión (junto al docente, sep 2026): dejar los `<svg>` inlineados en
 * el HTML persistido. El cap `MAX_COVER_LIVE_PROJECT_BYTES = 3MB` ya cubre
 * una portada con SVGs grandes (logos institucionales con paths complejos).
 *
 * ## Diseño
 *
 * • Encontrar todos los matches de `<img data:>` en el HTML.
 * • Ordenarlos por posición (orden de aparición en el HTML).
 * • Validar tamaños ANTES de escribir: si UNO excede el cap, ningún
 *   archivo se persiste, el HTML original queda intacto y el caller
 *   recibe el error.
 * • Walk por índices construyendo el HTML resultado. Reemplazamos SOLO el
 *   `src` del `<img>` para preservar el resto de atributos (class, alt).
 * • Saves en paralelo (`Promise.all`).
 *
 * ## Límites
 *
 *   • `MAX_ASSET_BYTES = 1_000_000` — un asset individual no debería pasar
 *     de 1MB (logos institucionales pueden pesar 300-600KB).
 *   • `MAX_ASSETS_PER_SAVE = 50` — una portada tiene 5-10 assets como
 *     mucho. 50 da holgura sin permitir N=1000 (DoS).
 *
 * ## Cleanup
 *
 * El caller (server action) es responsable de borrar los archivos del
 * save ANTERIOR antes de invocar este helper.
 */
import { randomUUID } from "node:crypto";
import { type DomainError } from "@/shared/domain/result";

export type WriteUpload = (relativePath: string, data: Buffer) => Promise<string>;

export interface ExtractInlineAssetsOptions {
  institutionId: string;
  bundleId: string;
  save: WriteUpload;
}

export interface ExtractInlineAssetsResult {
  /** HTML con los assets reemplazados por `<img src="/api/uploads/...">`. */
  html: string;
  /** Paths relativos a STORAGE_DIR de los assets extraídos en este save. */
  extractedAssets: string[];
}

/** Defensa contra assets individuales gigantes. 1MB cubre logos
 *  institucionales de alta resolución (PNG con transparencia, fotos de
 *  decoraciones) sin permitir N×10MB (DoS). */
export const MAX_ASSET_BYTES = 1_000_000;

/** Defensa contra N=1000 assets por save (DoS). */
export const MAX_ASSETS_PER_SAVE = 50;

// Captura solo el atributo `src="data:..."` — así el reemplazo preserva
// el resto de atributos del `<img>` (class, alt, width, etc.).
const IMG_DATA_SRC_PATTERN =
  /\bsrc="(data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,([A-Za-z0-9+/=]+))"/gi;

const UPLOADS_PREFIX = "/api/uploads/";

/** Subtipo MIME → extensión de archivo. */
const EXT_FOR_SUBTYPE: Record<string, string> = {
  png: "png",
  jpg: "jpg",
  jpeg: "jpg",
  gif: "gif",
  webp: "webp",
  "svg+xml": "svg",
};

export class TooManyInlineAssetsError extends Error {
  readonly code = "TOO_MANY_INLINE_ASSETS" as const;
}

export class OversizedInlineAssetError extends Error {
  readonly code = "OVERSIZED_INLINE_ASSET" as const;
}

export function isExtractInlineAssetsError(err: unknown): err is DomainError & { code: string } {
  return err instanceof TooManyInlineAssetsError || err instanceof OversizedInlineAssetError;
}

type Entry = { match: RegExpMatchArray; index: number };

interface BuildItem {
  relative: string;
  buffer: Buffer;
  /** Para `<img>`: solo el nuevo src (preserva el resto de atributos). */
  replacement: string;
}

/**
 * Recorre el HTML, extrae las imágenes base64 inline de
 * `<img src="data:...">` y reemplaza el `src` por la URL `/api/uploads/...`
 * del archivo guardado. Devuelve el HTML slimmed y la lista de paths
 * extraídos.
 *
 * NOTA (sep 2026): los `<svg>...</svg>` inline YA NO se extraen — su
 * procesamiento anterior destruía atributos del SVG. Ver docstring del
 * módulo para los detalles de la decisión.
 */
export async function extractInlineAssets(
  html: string,
  opts: ExtractInlineAssetsOptions,
): Promise<ExtractInlineAssetsResult> {
  // (sep 2026) Solo procesamos `<img data:...>` — los SVGs inline
  // permanecen literales en el HTML (ver docstring del módulo).
  const allMatches: Entry[] = [...html.matchAll(IMG_DATA_SRC_PATTERN)].map((m) => ({
    match: m,
    index: m.index ?? 0,
  }));

  if (allMatches.length === 0) {
    return { html, extractedAssets: [] };
  }

  if (allMatches.length > MAX_ASSETS_PER_SAVE) {
    throw new TooManyInlineAssetsError(
      `La portada tiene ${allMatches.length} imágenes inline (data URIs). Máximo permitido: ${MAX_ASSETS_PER_SAVE}.`,
    );
  }

  // Validar tamaños ANTES de escribir (atomic-ish: si uno excede, no
  // tocamos disco).
  for (const entry of allMatches) {
    const base64Data = entry.match[3] ?? "";
    const bytes = Buffer.byteLength(base64Data, "base64");
    if (bytes > MAX_ASSET_BYTES) {
      throw new OversizedInlineAssetError(
        `Una imagen inline mide ${bytes} bytes (decodificada). Máximo por asset: ${MAX_ASSET_BYTES}.`,
      );
    }
  }

  // Walk por índices construyendo items + resultado.
  const items: BuildItem[] = [];
  let result = "";
  let lastEnd = 0;

  for (const entry of allMatches) {
    const start = entry.index;
    result += html.slice(lastEnd, start);

    const subtype = entry.match[2] ?? "png";
    const base64Data = entry.match[3] ?? "";
    const ext = EXT_FOR_SUBTYPE[subtype] ?? "bin";
    const id = randomUUID().slice(0, 12);
    const relative = `institutions/${opts.institutionId}/cover-html/${opts.bundleId}/${id}.${ext}`;
    items.push({
      relative,
      buffer: Buffer.from(base64Data, "base64"),
      // Solo el nuevo `src="..."` — preserva el resto del <img> original.
      replacement: `src="${UPLOADS_PREFIX}${relative}"`,
    });

    result += items[items.length - 1]!.replacement;
    lastEnd = start + entry.match[0].length;
  }
  result += html.slice(lastEnd);

  // Escribir a disco en paralelo.
  await Promise.all(items.map((item) => opts.save(item.relative, item.buffer)));

  return {
    html: result,
    extractedAssets: items.map((item) => item.relative),
  };
}
