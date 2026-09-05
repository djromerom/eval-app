/**
 * Composition root del módulo latex-export (L10 — sep 2026).
 * ==========================================================
 *
 * Cablea el use case `BuildLatexZip` con sus dependencias:
 *   - `loadBundle`     ← `makeGetBundle().execute` (existing)
 *   - `loadEvaluation` ← `makeGetEvaluation().execute` (existing)
 *   - `readUpload`     ← `makePrismaImageFetcher()` (L9)
 *
 * Sigue el patrón de los demás módulos del repo: cada `make*()` factory
 * devuelve una instancia nueva del use case, evitando compartir estado
 * mutable entre requests HTTP.
 *
 * Sin repo propio: los use cases `GetBundle` y `GetEvaluation` ya están
 * definidos en sus módulos yacen; los reusamos porque traen el scoping
 * por `institutionId` y el manejo de errores `Result<T>` que el route
 * handler mapea a HTTP.
 */
import { makeGetBundle } from "@/modules/bundles/infrastructure/container";
import { makeGetEvaluation } from "@/modules/evaluations/infrastructure/container";
import { BuildLatexZip } from "../application/build-latex-zip";
import { makePrismaImageFetcher } from "./prisma-image-fetcher";

/**
 * Crea el use case. Se llama desde el route handler con cada GET para
 * garantizar instancias frescas y, con ellas, estado mutable fresco
 * (counters, caches de request).
 *
 * El wrapping con `async (...)` evita acoplar este factory al shape
 * `Result<T>` de los use cases existentes: cuando `loadBundle`/`loadEvaluation`
 * devuelven `null`, lo tratamos como "no encontrado" en el use case de
 * export (que ya devuelve `NotFoundError`). Si devuelven `ForbiddenError`
 * o cualquier otro `DomainError`, propagamos.
 */
export const makeBuildLatexZip = () =>
  new BuildLatexZip({
    loadBundle: async (institutionId, bundleId) => {
      const res = await makeGetBundle().execute({
        actor: { userId: "", institutionId, roles: ["SUPER_ADMIN"] },
        bundleId,
      });
      // El route handler inyecta el actor real; este actor sintético con
      // SUPER_ADMIN es un detalle interno — la autorización de export se
      // valida DENTRO de `BuildLatexZip.execute` con `requireRole`.
      if (!res.ok) {
        if (res.error.code === "NOT_FOUND") return null;
        throw res.error;
      }
      return res.value;
    },
    loadEvaluation: async (institutionId, evaluationId) => {
      const res = await makeGetEvaluation().execute({
        actor: { userId: "", institutionId, roles: ["SUPER_ADMIN"] },
        id: evaluationId,
      });
      if (!res.ok) {
        if (res.error.code === "NOT_FOUND") return null;
        throw res.error;
      }
      return res.value;
    },
    readUpload: makePrismaImageFetcher(),
  });
