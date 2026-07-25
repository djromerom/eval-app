import "./load-env";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Worker } from "bullmq";
import puppeteer from "puppeteer";
import { env } from "@/config/env";
import { type PrintKind, signPrintToken } from "@/shared/infrastructure/crypto/print-token";
import { imposeBooklet } from "@/shared/imposition/booklet-pdf";
import {
  type PdfGenerationJob,
  type PdfGenerationResult,
  QUEUE_NAMES,
  getBullMQPrefix,
  getRedisConnection,
} from "@/shared/infrastructure/queue/queues";
import { logger } from "@/shared/infrastructure/logger";

/**
 * Worker de generación de PDF server-side (REQUERIMIENTOS_v2.md §3.4).
 *
 * Pipeline en 2 pasos:
 *   1. Puppeteer abre /print/{kind}/{id}?t={token} con la plantilla carta
 *      (la misma que el método primario del navegador) y genera un PDF
 *      lineal, una página lógica por página PDF.
 *   2. pdf-lib impone saddle-stitch sobre pliegos doble carta (17×11
 *      horizontal), reordenando las páginas de modo que al imprimir a
 *      doble cara, doblar al centro y grapar por el lomo, el lector
 *      hojee el examen en orden 1..N.
 *
 * Para compendios (multi-evaluación) se preserva la primera página del PDF
 * lineal como portada institucional (sin imposition). Si se impusiera con
 * el resto, la portada ocuparía media hoja tabloid desperdiciando la otra
 * media — bug documentado al cambiar de "una columna" a "dos páginas".
 *
 * El método primario del navegador (print CSS en carta) sigue siendo el
 * principal; este worker es para cuando el colegio quiere el cuadernillo
 * formal listo para imprenta.
 */
const log = logger.child({ worker: "pdf" });

const ROUTE_BY_KIND: Record<PrintKind, string> = {
  booklet: "/print/evaluation",
  "answer-sheets": "/print/bulk-answer-sheets",
  "answer-key": "/print/answer-key",
  bundle: "/print/bundle",
  "answer-sheets-bundle": "/print/answer-sheets/bundle", // Sprint 2
  "answer-key-bundle": "/print/answer-key/bundle", // Sprint 3
};

/**
 * Kinds cuyo `targetId` es un `bundleId` (el resto usa `evaluationId`).
 * Derivado de ROUTE_BY_KIND para que añadir una ruta `/print/**\/bundle`
 * nueva no requiera acordarse de tocar también el check del worker.
 */
const BUNDLE_KINDS = new Set<PrintKind>(
  (Object.keys(ROUTE_BY_KIND) as PrintKind[]).filter((k) => ROUTE_BY_KIND[k].includes("bundle")),
);

/** Genera el PDF lineal (carta, 1 página por hoja lógica) con Puppeteer. */
async function renderLinearPdf(url: string): Promise<Uint8Array> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    const res = await page.goto(url, { waitUntil: "networkidle0", timeout: 60_000 });
    if (!res || !res.ok()) {
      throw new Error(`No se pudo cargar la página de impresión (HTTP ${res?.status()})`);
    }
    if (page.url().includes("/login")) {
      throw new Error("Acceso a /print rechazado (token inválido)");
    }
    return await page.pdf({
      format: "letter",
      printBackground: true,
      preferCSSPageSize: false,
    });
  } finally {
    await browser.close();
  }
}

const worker = new Worker<PdfGenerationJob, PdfGenerationResult>(
  QUEUE_NAMES.pdfGeneration,
  async (job) => {
    const { evaluationId, bundleId, institutionId, kind, extraQuery } = job.data;
    // XOR explícito: o evaluación o compendio, nunca ambos.
    // Todo kind cuya ruta cuelga de un compendio va aquí — incluida
    // `answer-key-bundle`, que quedó fuera al añadirse en Sprint 3 y hacía
    // fallar el job pidiendo un `evaluationId` que nunca se envía.
    const isBundleKind = BUNDLE_KINDS.has(kind);
    const targetId = isBundleKind ? bundleId : evaluationId;
    if (!targetId) {
      throw new Error(
        `PdfGenerationJob incompleto: falta ${isBundleKind ? "bundleId" : "evaluationId"}`,
      );
    }

    const tokenAccess: Parameters<typeof signPrintToken>[0] = isBundleKind
      ? { bundleId: targetId, institutionId, kind }
      : { evaluationId: targetId, institutionId, kind };

    log.info({ jobId: job.id, targetId, kind }, "Generando PDF");

    const token = signPrintToken(tokenAccess);
    // PRINT_BASE_URL tiene prioridad sobre AUTH_URL: en prod AUTH_URL apunta al
    // público (https://ecognia.pro) pero los workers deben fetchear del
    // servidor interno donde corre Next (donde están las rutas /print/*).
    // En dev permite evitar el conflicto de puertos (e.g. otro contenedor
    // tiene 3000 pero Next corre en 3002).
    const baseUrl = env.PRINT_BASE_URL ?? env.AUTH_URL ?? "http://localhost:3000";
    const queryString = extraQuery ? `&${extraQuery}` : "";
    const url = `${baseUrl}${ROUTE_BY_KIND[kind]}/${targetId}?t=${encodeURIComponent(token)}${queryString}`;

    // Paso 1: PDF lineal en carta.
    const linear = await renderLinearPdf(url);
    log.info({ jobId: job.id, linearBytes: linear.length }, "PDF lineal generado");

    // Paso 2: imposition saddle-stitch a doble carta. Los compendios
    // preservan la primera página (portada institucional) sin imposition
    // para no desperdiciar media hoja tabloid; el resto del cuerpo sí se
    // impone. Los cuadernillos de una sola evaluación se imponen enteros
    // (comportamiento legacy): portada y contraportada comparten pliego.
    const imposed = await imposeBooklet(linear, {
      coverPages: isBundleKind ? 1 : 0,
    });
    log.info({ jobId: job.id, imposedBytes: imposed.length }, "Imposición aplicada");

    const dir = path.join(env.STORAGE_DIR, "pdf", institutionId);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${targetId}-${kind}.pdf`);
    await writeFile(filePath, imposed);

    return { evaluationId, bundleId, institutionId, kind, path: filePath };
  },
  { connection: getRedisConnection(), prefix: getBullMQPrefix(), concurrency: 1 },
);

worker.on("completed", (job) => log.info({ jobId: job.id }, "PDF generado"));
worker.on("failed", (job, err) => log.error({ jobId: job?.id, err }, "Fallo al generar PDF"));

log.info("Worker PDF iniciado, esperando trabajos…");

async function shutdown() {
  log.info("Cerrando worker PDF…");
  await worker.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
