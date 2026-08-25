import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { env } from "@/config/env";
import { type FileStorage } from "@/shared/infrastructure/storage/local-storage";
import { type CoverAssetResolver } from "../application/preview-cover";

/**
 * Adaptador concreto de `CoverAssetResolver` que lee del FileStorage local.
 *
 * Si el path es null, devuelve null sin tocar FS (la plantilla tiene
 * fallbacks de texto). Si el path es URL absoluta (`http://`, `data:`,
 * `/static/...`), NO se resuelve — pasa tal cual al iframe.
 *
 * Para paths del filesystem probamos varios candidatos, en este orden:
 *   1. El path literal (cubre el caso "ideal": `institutions/{id}/logo.png`
 *      guardado por `localStorage.save()`).
 *   2. `STORAGE_DIR/path` (cubre seeds/scripts viejos que guardaron
 *      un path sin la raíz storage).
 *   3. Si el path arranca con `storage/`, lo probamos sin ese prefijo
 *      (cubre seeds que duplicaron el prefijo).
 *   4. Si el path es absoluto, lo probamos directo (cubre el seed de
 *      `seed-reference-evaluation.ts` que guarda la ruta absoluta del
 *      archivo de assets).
 *
 * Si ninguno funciona (archivo borrado / permisos / ruta inválida),
 * devolvemos null y la plantilla pintará el fallback de texto. NO
 * lanzamos: el preview sigue siendo útil aunque falte el logo.
 */
export class LocalCoverAssetResolver implements CoverAssetResolver {
  constructor(private readonly storage: FileStorage) {}

  async resolveToDataUrl(path: string | null): Promise<string | null> {
    if (!path) return null;
    if (
      path.startsWith("data:") ||
      path.startsWith("http://") ||
      path.startsWith("https://") ||
      path.startsWith("blob:")
    ) {
      return path;
    }

    const candidates: string[] = [path];
    candidates.push(join(env.STORAGE_DIR, path));
    if (path.startsWith("storage/")) {
      candidates.push(path.slice("storage/".length));
    }
    if (isAbsolute(path)) {
      candidates.push(path);
    }

    for (const candidate of candidates) {
      // Probamos primero via localStorage (valida path traversal). Si
      // falla por ENOENT o cualquier otro motivo, probamos existsSync
      // directo (cubre rutas absolutas que están fuera del STORAGE_DIR).
      try {
        const buf = await this.storage.read(candidate);
        return toDataUrl(candidate, buf);
      } catch {
        if (existsSync(candidate)) {
          try {
            const buf = readFileSync(candidate);
            return toDataUrl(candidate, buf);
          } catch {
            // continúa con el siguiente candidato
          }
        }
      }
    }
    return null;
  }
}

function toDataUrl(path: string, buf: Buffer): string {
  const lower = path.toLowerCase();
  const ext =
    lower.endsWith(".jpg") || lower.endsWith(".jpeg")
      ? "jpeg"
      : lower.endsWith(".gif")
        ? "gif"
        : lower.endsWith(".webp")
          ? "webp"
          : "png";
  return `data:image/${ext};base64,${buf.toString("base64")}`;
}
