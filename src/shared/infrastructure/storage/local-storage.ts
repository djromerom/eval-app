import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { env } from "@/config/env";

/**
 * Almacenamiento en disco local del VPS (imágenes escaneadas, PDFs).
 * Backup a S3 es opcional y se agregaría como otra implementación
 * de esta misma interfaz (ver REQUERIMIENTOS_v2.md §5).
 */
export interface FileStorage {
  save(relativePath: string, data: Buffer): Promise<string>;
  read(relativePath: string): Promise<Buffer>;
}

function resolveSafe(relativePath: string): string {
  const full = normalize(join(env.STORAGE_DIR, relativePath));
  if (!full.startsWith(normalize(env.STORAGE_DIR))) {
    throw new Error(`Ruta fuera del directorio de almacenamiento: ${relativePath}`);
  }
  return full;
}

export const localStorage: FileStorage = {
  async save(relativePath, data) {
    const full = resolveSafe(relativePath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
    return relativePath;
  },
  async read(relativePath) {
    return readFile(resolveSafe(relativePath));
  },
};
