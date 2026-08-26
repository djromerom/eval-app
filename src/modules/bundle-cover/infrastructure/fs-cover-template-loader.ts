import { promises as fs } from "node:fs";
import path from "node:path";
import { NotFoundError } from "@/shared/domain/result";
import { type CoverTemplateKey, type CoverTemplateLoader } from "../domain/cover-template";

/** Directorio raíz donde viven los HTML versionados. */
export const COVER_TEMPLATES_DIR = path.join(process.cwd(), "templates", "cover");

/**
 * Adaptador: lee de `templates/cover/{key}.html` en el FS del proceso.
 * Caché en memoria porque las plantillas son estáticas durante la vida del
 * proceso — si se cambia un built-in, hay que reiniciar el server de todos
 * modos (Next.js dev recompila, prod requiere redeploy).
 */
export class FsCoverTemplateLoader implements CoverTemplateLoader {
  private readonly cache = new Map<CoverTemplateKey, string>();

  /** Carga lazy: solo lee del FS la primera vez que se pide cada key. */
  async loadBuiltIn(key: CoverTemplateKey): Promise<string> {
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const filePath = path.join(COVER_TEMPLATES_DIR, `${key}.html`);
    let body: string;
    try {
      body = await fs.readFile(filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new NotFoundError("Plantilla de portada", key);
      }
      throw err;
    }
    this.cache.set(key, body);
    return body;
  }

  async listAvailableKeys(): Promise<CoverTemplateKey[]> {
    // El FS puede tener archivos adicionales (e.g. _previews/, README.md).
    // Filtramos a `${familia}-v${n}.html` por convención.
    let entries: string[];
    try {
      entries = await fs.readdir(COVER_TEMPLATES_DIR);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }
    const KEY_RE = /^([a-z][a-z0-9-]{0,30}-v\d+)\.html$/;
    const keys: CoverTemplateKey[] = [];
    for (const entry of entries) {
      const match = KEY_RE.exec(entry);
      if (match) keys.push(match[1] as CoverTemplateKey);
    }
    return keys.sort();
  }
}
