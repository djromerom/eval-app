/**
 * Extrae assets inline (SVGs + imágenes base64) de una portada HTML y los
 * guarda como archivos en disco (ago 2026).
 * ===============================================================
 *
 * ## Por qué existe
 *
 * Una portada con assets inline puede inflar el HTML hasta superar los
 * límites del use case (`MAX_COVER_LIVE_PROJECT_BYTES = 200KB`):
 *
 *   • `<svg>` vectoriales complejos (logos, iconos): cada uno ~10-100KB.
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
 * ## Tipos soportados
 *
 *   • SVG vectorial — match `<svg>...</svg>`. Guarda como `.svg` (texto UTF-8).
 *   • Imágenes raster — match `<img src="data:image/<subtype>;base64,...">`
 *     donde subtype ∈ {png, jpg, jpeg, gif, webp}. Guarda como `.png`/`.jpg`/
 *     `.gif`/`.webp` (binario decodificado de base64).
 *
 * ## Diseño
 *
 * • Encontrar todos los matches de SVG y `<img data:>` en el HTML.
 * • Ordenarlos por posición (orden de aparición en el HTML).
 * • Validar tamaños ANTES de escribir: si UNO excede el cap, ningún
 *   archivo se persiste, el HTML original queda intacto y el caller
 *   recibe el error.
 * • Walk por índices construyendo el HTML resultado. Para SVG reemplazamos
 *   el elemento completo por `<img>`; para `<img data:>` reemplazamos
 *   SOLO el `src` para preservar el resto de atributos (class, alt, etc).
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

const SVG_PATTERN = /<svg\b[^>]*>[\s\S]*?<\/svg>/gi;
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

type SvgEntry = { kind: "svg"; match: RegExpMatchArray };
type ImgEntry = { kind: "img"; match: RegExpMatchArray };
type Entry = (SvgEntry | ImgEntry) & { index: number };

interface BuildItem {
  relative: string;
  buffer: Buffer;
  /** Para SVG: el `<img>` completo. Para IMG: solo el nuevo src. */
  replacement: string;
}

/**
 * Recorre el HTML, extrae los assets (SVGs + imágenes base64) y los
 * reemplaza por `<img>` apuntando al archivo guardado. Devuelve el HTML
 * slimmed y la lista de paths extraídos.
 */
export async function extractInlineAssets(
  html: string,
  opts: ExtractInlineAssetsOptions,
): Promise<ExtractInlineAssetsResult> {
  // Recolectar matches de ambos patrones.
  const svgRaw = [...html.matchAll(SVG_PATTERN)];
  const imgRaw = [...html.matchAll(IMG_DATA_SRC_PATTERN)];

  const allMatches: Entry[] = [
    ...svgRaw.map((m): SvgEntry & { index: number } => ({
      kind: "svg",
      match: m,
      index: m.index ?? 0,
    })),
    ...imgRaw.map((m): ImgEntry & { index: number } => ({
      kind: "img",
      match: m,
      index: m.index ?? 0,
    })),
  ].sort((a, b) => a.index - b.index);

  if (allMatches.length === 0) {
    return { html, extractedAssets: [] };
  }

  if (allMatches.length > MAX_ASSETS_PER_SAVE) {
    throw new TooManyInlineAssetsError(
      `La portada tiene ${allMatches.length} assets inline (SVGs o imágenes). Máximo permitido: ${MAX_ASSETS_PER_SAVE}.`,
    );
  }

  // Validar tamaños ANTES de escribir (atomic-ish: si uno excede, no
  // tocamos disco).
  for (const entry of allMatches) {
    if (entry.kind === "svg") {
      const bytes = Buffer.byteLength(entry.match[0], "utf8");
      if (bytes > MAX_ASSET_BYTES) {
        throw new OversizedInlineAssetError(
          `Un SVG inline mide ${bytes} bytes. Máximo por asset: ${MAX_ASSET_BYTES}.`,
        );
      }
    } else {
      const base64Data = entry.match[3] ?? "";
      const bytes = Buffer.byteLength(base64Data, "base64");
      if (bytes > MAX_ASSET_BYTES) {
        throw new OversizedInlineAssetError(
          `Una imagen inline mide ${bytes} bytes (decodificada). Máximo por asset: ${MAX_ASSET_BYTES}.`,
        );
      }
    }
  }

  // Walk por índices construyendo items + resultado.
  const items: BuildItem[] = [];
  let result = "";
  let lastEnd = 0;

  for (const entry of allMatches) {
    const start = entry.index;
    result += html.slice(lastEnd, start);

    if (entry.kind === "svg") {
      const svgText = entry.match[0];
      const id = randomUUID().slice(0, 12);
      const relative = `institutions/${opts.institutionId}/cover-html/${opts.bundleId}/${id}.svg`;
      items.push({
        relative,
        buffer: Buffer.from(svgText, "utf8"),
        replacement: `<img src="${UPLOADS_PREFIX}${relative}" alt="" class="cover-html-extracted-asset" />`,
      });
    } else {
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
    }

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
