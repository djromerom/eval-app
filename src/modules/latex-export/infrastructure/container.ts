/**
 * Composition root del módulo latex-export (L10 — sep 2026, fix 5 sep 2026).
 * ========================================================================
 *
 * Cablea el use case `BuildLatexZip` con sus dependencias:
 *   - `loadBundle`     ← `PrismaBundleRepository.findDetail` (directo)
 *   - `loadEvaluation` ← `PrismaEvaluationRepository.getDetail` (directo)
 *   - `readUpload`     ← `makePrismaImageFetcher()` (L9)
 *
 * ## Por qué repos directos (no `makeGetBundle`/`makeGetEvaluation`)
 *
 * Inicialmente el container cableaba contra los use cases `GetBundle` y
 * `GetEvaluation` reusando el scoping existente. Eso funcionaba para
 * `GetBundle` (no tiene role check interno), pero rompía con
 * `GetEvaluation`: su `execute()` hace `requireRole(actor, "TEACHER",
 * "ECU_LIDER", "ECU_MASTER")` y rechaza actores con sólo `SUPER_ADMIN`
 * — que es justo quien la route handler del export SÍ deja pasar
 * (porque tiene capability `manage-bundles`).
 *
 * Solución: el container llama directo a los repos, saltándose los use
 * cases intermedios. La route ya validó `requireAuthenticatedUser +
 * can("manage-bundles")` ANTES de invocar `BuildLatexZip.execute`, así
 * que re-validar el rol dentro de los loaders sería duplicar trabajo
 * y reintroducir el bug. `BuildLatexZip.execute` mantiene su propio
 * `requireRole` interno como defensa en profundidad.
 *
 * Sin repo propio: los repos ya están definidos en sus módulos yacen;
 * los reusamos porque traen el scoping por `institutionId` (RLS) y
 * devuelven `null` cuando no hay match (lo que el use case de export
 * mapea a `NotFoundError`).
 */
import { PrismaBundleRepository } from "@/modules/bundles/infrastructure/prisma-bundle-repository";
import { PrismaEvaluationRepository } from "@/modules/evaluations/infrastructure/prisma-evaluation-repository";
import { BuildLatexZip } from "../application/build-latex-zip";
import { makePrismaImageFetcher } from "./prisma-image-fetcher";

// Instancias módulo-scope: los repos son stateless (solo dependen del
// cliente Prisma que ya es singleton). Reusar entre requests evita
// gastar el overhead de instanciar Prisma internamente.
const bundleRepository = new PrismaBundleRepository();
const evaluationRepository = new PrismaEvaluationRepository();

/**
 * Crea el use case. Se llama desde el route handler con cada GET para
 * garantizar instancias frescas y, con ellas, estado mutable fresco
 * (los `EvaluationImageRegistry` se crean dentro de `execute` por
 * evaluación, así que no hay riesgo de fuga entre requests).
 *
 * `loadBundle`/`loadEvaluation` devuelven `null` cuando el repo no
 * encuentra el registro — el use case de export lo convierte en
 * `NotFoundError`.
 */
export const makeBuildLatexZip = () =>
  new BuildLatexZip({
    loadBundle: async (institutionId, bundleId) =>
      bundleRepository.findDetail(institutionId, bundleId),
    loadEvaluation: async (institutionId, evaluationId) =>
      evaluationRepository.getDetail(institutionId, evaluationId),
    readUpload: makePrismaImageFetcher(),
  });
