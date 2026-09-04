/**
 * Resolución de imágenes para el ZIP LaTeX (L8 — sep 2026).
 * =========================================================
 *
 * Helper puro que toma el `src` de un nodo `<image>` TipTap y decide
 * qué hacer con él. Devuelve uno de:
 *   • `{ kind: "inline", storagePath, ext, mime, uniqueName }` — la imagen
 *     se copiará al ZIP y se referenciará vía `\includegraphics`.
 *   • `{ kind: "skip", reason }` — la imagen se omitirá y el walker
 *     emitirá un comentario `% [imagen ... omitida: ...]`.
 *
 * El use case `BuildLatexZip` consume esta decisión + el buffer que
 * `prisma-image-fetcher` (L9) lee del storage local.
 *
 * NO hace I/O — solo parsea el `src` y computa nombres. El acoplamiento
 * con filesystem queda en L9.
 *
 * Reusos:
 *   • `storagePathFromUploadUrl(src)` para extraer el path relativo
 *     de URLs `/api/uploads/...` (definido en `uploads/domain/upload.ts`).
 *   • `mimeForPath()` duplicado de `cover-html/application/inline-html-images.ts`
 *     (no se exporta desde allí); son 6 líneas que cubren los formatos
 *     que `extractInlineAssets` guarda.
 */
import { storagePathFromUploadUrl, UPLOAD_URL_PREFIX } from "@/modules/uploads/domain/upload";
import type { ImageResolution } from "../domain/latex-walker";

export interface InlineImageRef {
  kind: "inline";
  /** Path relativo en el storage local (input de `localStorage.read`). */
  storagePath: string;
  /** Extensión del archivo en disco (`.png`, `.jpg`, `.svg`, etc.). */
  ext: string;
  /** MIME type para logs/debug. */
  mime: string;
  /** Filename único dentro de `images/` en el ZIP. */
  uniqueName: string;
}

// ---------------------------------------------------------------------------
// MIME por extensión (mirror de inline-html-images.ts:mimeForPath)
// ---------------------------------------------------------------------------

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function mimeForPath(path: string): string {
  const lower = path.toLowerCase();
  for (const [ext, mime] of Object.entries(MIME_BY_EXT)) {
    if (lower.endsWith(ext)) return mime;
  }
  return "application/octet-stream";
}

function extForPath(path: string): string {
  const slash = path.lastIndexOf("/");
  const filename = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot) : "";
}

// ---------------------------------------------------------------------------
// Resolución
// ---------------------------------------------------------------------------

/**
 * Decide qué hacer con un `src` de imagen. Pura, sin I/O.
 *
 * @param src El `attrs.src` del nodo `<image>` TipTap.
 * @param seenCountMap Mapa mutable compartido entre llamadas: lleva el
 *   contador de imágenes ya procesadas para generar filenames únicos
 *   (`img-1.png`, `img-2.png`, ...) incluso si dos questions tienen
 *   imágenes con la misma URL.
 */
export function resolveImageSrc(
  src: string,
  seenCountMap: Map<string, number>,
): ImageResolution | InlineImageRef {
  if (!src || typeof src !== "string") {
    return { kind: "skip", reason: "unknown" };
  }

  // Caso 1: `/api/uploads/...` → resolver a storage path local.
  if (src.startsWith(UPLOAD_URL_PREFIX)) {
    const storagePath = storagePathFromUploadUrl(src);
    if (!storagePath) {
      return { kind: "skip", reason: "unknown" };
    }

    const ext = extForPath(storagePath);
    const mime = mimeForPath(storagePath);

    // Generar unique name: `img-N.ext` (N correlativo por storagePath).
    const count = (seenCountMap.get(storagePath) ?? 0) + 1;
    seenCountMap.set(storagePath, count);
    const uniqueName = `img-${count}${ext}`;

    return {
      kind: "inline",
      storagePath,
      ext,
      mime,
      uniqueName,
    };
  }

  // Caso 2: data: URI → omitida (Overleaf no las soporta inline en imágenes).
  if (src.startsWith("data:")) {
    return { kind: "skip", reason: "data" };
  }

  // Caso 3: http(s) o cualquier otra cosa → externa.
  if (src.startsWith("http://") || src.startsWith("https://")) {
    return { kind: "skip", reason: "external" };
  }

  return { kind: "skip", reason: "unknown" };
}
