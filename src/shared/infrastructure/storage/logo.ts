import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

/**
 * Lee el logo institucional desde disco y lo devuelve como data URL (base64)
 * para embeber inline en el HTML que Puppeteer va a renderizar. Centralizado
 * para evitar divergencias silenciosas entre las páginas `/print/*` que lo
 * usan (cuadernillo, portada, informe por grupo).
 *
 * Devuelve `null` si no se debe mostrar (`showLogo=false`), si no hay path,
 * o si el archivo no existe / no se puede leer. Esto último es importante:
 * un docente que aún no subió logo simplemente ve la página sin imagen, no
 * un error 500.
 */
export async function readLogoIfNeeded(
  path: string | null | undefined,
  showLogo: boolean,
): Promise<string | null> {
  if (!showLogo || !path) return null;
  const candidates = [
    path,
    path.startsWith("/") ? path : `${process.env.STORAGE_DIR ?? "./storage"}/${path}`,
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const buf = await readFile(candidate);
        const ext = candidate.toLowerCase().endsWith(".png") ? "png" : "jpeg";
        return `data:image/${ext};base64,${buf.toString("base64")}`;
      } catch {
        return null;
      }
    }
  }
  return null;
}
