/**
 * Fetcher de imágenes para el ZIP LaTeX (L9 — sep 2026).
 * =========================================================
 *
 * Implementación de producción de `ReadUpload` sobre `localStorage`.
 *
 * Por qué existe como archivo aparte:
 *   - El dominio (`latex-walker.ts`, `resolve-evaluation-image-buffer.ts`) es
 *     PURO — no toca Prisma ni filesystem, es 100 % testeable sin I/O.
 *   - El use case `BuildLatexZip` (L11) recibe un `ReadUpload` inyectado en
 *     su constructor. En prod, este archivo lo provee; en tests, se inyecta
 *     un fake in-memory.
 *
 * Comportamiento:
 *   - Hit (archivo existe) → `Promise<Buffer>` con el binario.
 *   - Miss (`ENOENT`) → `Promise<null>`. Esto permite que el use case emita
 *     un comentario `% [imagen omitida en storage: <path>]` en el .tex
 *     correspondiente en vez de reventar la exportación entera. Coincide
 *     con el patrón de `inlineContentImages` (uploads/application/...) que
 *     también devuelve `null` en miss para no romper el PDF.
 *   - Otro error I/O (permisos, EISDIR) → propaga. El export falla
 *     ruidosamente: mejor 500 al docente que un PDF sin imágenes críticas.
 *
 * Layer rule (ESLint): este archivo vive en `infrastructure/` — SÍ puede
 * importar `@prisma/client` (no lo hace hoy) y/o módulos de
 * `shared/infrastructure/`.
 *
 * Sin archivo de test: es producción pura. La cobertura llega por el test
 * end-to-end de L11 con un fake en memoria.
 */

import { localStorage } from "@/shared/infrastructure/storage/local-storage";

/**
 * Lee un binario del storage local.
 *
 * - En prod: `makePrismaImageFetcher()` resuelve cada llamada vía
 *   `localStorage.read()`.
 * - En tests: se inyecta un fake `(path) => Promise<Buffer | null>` para
 *   poder simular hits/misses sin disco.
 *
 * Devuelve `null` (no `throw`) cuando el archivo no existe — eso permite
 * al use case emitir un "skip" en el .tex en vez de crashear el ZIP.
 */
export type ReadUpload = (relativePath: string) => Promise<Buffer | null>;

/**
 * Factory de la implementación de producción. Se llama en `container.ts`
 * (L10) cuando se construye el use case:
 *
 * ```ts
 * export const makeBuildLatexZip = () =>
 *   new BuildLatexZipUseCase({
 *     ...,
 *     readUpload: makePrismaImageFetcher(),
 *   });
 * ```
 *
 * El wrapper try/catch existe solo para categorizar `ENOENT` como "miss
 * silencioso". Cualquier otro error se propaga tal cual — son bugs reales
 * del storage (permisos, EISDIR, ENOTDIR…) que merecen un 500 visible.
 */
export function makePrismaImageFetcher(): ReadUpload {
  return async (relativePath: string): Promise<Buffer | null> => {
    try {
      return await localStorage.read(relativePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | null)?.code;
      if (code === "ENOENT") return null;
      throw err;
    }
  };
}
