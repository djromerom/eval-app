import "./load-env";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Worker } from "bullmq";
import puppeteer from "puppeteer";
import { PDFDocument } from "pdf-lib";
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
  "cover-bundle": "/print/cover/bundle", // ago 2026: solo portada (1 página)
  "bundle-linear": "/print/bundle", // ago 2026: cuadernillo page-by-page (sin imposition)
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
      // Siempre carta portrait: el worker compone el pliego apaisado
      // manualmente con pdf-lib (Chromium no respeta `@page { size: ... }`
      // para apaisado ni con `@page :first` ni con named pages).
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

    // El token que firma el worker debe coincidir con el `kind` que la
    // página /print/* espera. La página /print/bundle/[id] solo conoce
    // `kind: "bundle"`; el flag `?linear=1` controla el rendering, no la
    // auth scope. Por eso cuando el job es `bundle-linear` firmamos el
    // token como `"bundle"` (la página lo acepta). El `kind` original del
    // job se sigue usando para el filename (`${targetId}-${kind}.pdf`).
    const isBundleLinearKind = kind === "bundle-linear";
    const tokenKind: PrintKind = isBundleLinearKind ? "bundle" : kind;

    const tokenAccess: Parameters<typeof signPrintToken>[0] = isBundleKind
      ? { bundleId: targetId, institutionId, kind: tokenKind }
      : { evaluationId: targetId, institutionId, kind: tokenKind };

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

    // Caso `bundle` (compendio con portada apaisada + booklet en carta):
    //
    //   Chrome NO permite mezclar tamaños de página dentro de un mismo PDF.
    //   `@page :first { size: ... }` y named pages (`page: foo`) solo
    //   aplican márgenes/contenido — el `size:` se ignora. La única vía
    //   fiable es renderizar la portada en su PROPIO PDF (un solo tamaño
    //   de hoja: tabloid landscape) y el cuerpo del booklet en otro (un
    //   solo tamaño: letter portrait), y unirlos con pdf-lib.
    //
    //   Para `cover-bundle` (descargar solo la portada) basta un render
    //   directo de `/print/cover/bundle/[id]` que ya tiene su `@page`
    //   dedicado a tabloid landscape (ver `print-cover.css` co-localizado).
    //
    //   Para los demás kinds (booklet de 1 evaluación, answer-sheets,
    //   answer-key, answer-sheets-bundle, answer-key-bundle) el flujo
    //   legacy sigue funcionando: 1 render + imposeBooklet.
    const isCoverOnlyKind = kind === "cover-bundle";
    const isBundleFullKind = kind === "bundle";

    let out: Uint8Array;

    if (isBundleLinearKind) {
      // Cuadernillo page-by-page: 1 render lineal con `?linear=1` (la ruta
      // /print/bundle/[id] detecta la flag y renderiza la portada como
      // `.sheet.cover` 8.5×11 en vez de `.sheet.cover-sheet` 17×11).
      // Sin imposition saddle-stitch — el usuario configura booklet imposition
      // desde el driver de su impresora sobre pliego tabloid apaisado.
      out = await renderLinearPdf(url);
      log.info({ jobId: job.id, bytes: out.length }, "PDF lineal (sin imposition) generado");
    } else if (isBundleFullKind) {
      // Portada apaisada. Puppeteer/Chromium NO pueden emitir una página
      // apaisada con `@page { size: tabloid landscape }` (ni con named
      // pages ni con `@page :first`); siempre sale portrait. Por eso
      // rendereamos la portada en carta (8.5×11) y luego la incrustamos
      // como MITAD DERECHA de un pliego doble carta apaisado (17×11).
      // La mitad izquierda queda en blanco — al doblar el pliego, queda
      // como interior de la portada del cuadernillo.
      const coverToken = signPrintToken({
        bundleId: targetId,
        institutionId,
        kind: "cover-bundle",
      });
      const coverUrl = `${baseUrl}/print/cover/bundle/${targetId}?t=${encodeURIComponent(coverToken)}`;
      const coverBytes = await renderLinearPdf(coverUrl);
      log.info({ jobId: job.id, coverBytes: coverBytes.length }, "PDF cover (carta) generado");

      // Cuerpo del booklet (letter portrait, N páginas). Render sin portada.
      const bodyToken = signPrintToken({
        bundleId: targetId,
        institutionId,
        kind: "bundle",
      });
      const bodyUrl = `${baseUrl}/print/bundle/${targetId}?t=${encodeURIComponent(bodyToken)}&bodyOnly=1`;
      const bodyLinear = await renderLinearPdf(bodyUrl);
      log.info({ jobId: job.id, bodyBytes: bodyLinear.length }, "PDF body (letter) generado");

      // Imponer solo el cuerpo (coverPages: 0 — la portada va aparte).
      const imposedBody = await imposeBooklet(bodyLinear, { coverPages: 0 });
      log.info({ jobId: job.id, imposedBytes: imposedBody.length }, "Cuerpo impuesto");

      // Componer el pliego portada: 17×11 apaisado (1224×792 pt) con la
      // portada original (8.5×11 = 612×792 pt) embebida en la mitad
      // DERECHA. La izquierda queda en blanco.
      const coverDoc = await PDFDocument.load(coverBytes);
      const coverSrcPage = coverDoc.getPages()[0];
      if (!coverSrcPage) throw new Error("Cover PDF sin páginas");

      const merged = await PDFDocument.create();
      const TABLOID_W = 17 * 72; // 1224 pt
      const TABLOID_H = 11 * 72; // 792 pt
      const HALF_W = 8.5 * 72; // 612 pt (carta portrait width)
      const HALF_H = 11 * 72; // 792 pt (carta portrait height)

      const tabloidPage = merged.addPage([TABLOID_W, TABLOID_H]);
      const embeddedCover = await merged.embedPage(coverSrcPage);
      // Embed a 8.5×11, posicionada en x = 8.5in (mitad derecha), y = 0 (full bleed vertical).
      tabloidPage.drawPage(embeddedCover, {
        x: HALF_W,
        y: 0,
        width: HALF_W,
        height: HALF_H,
      });
      log.info({ jobId: job.id, tabloidBytes: tabloidPage.getSize() }, "Pliego portada compuesto");

      // Merge: pliego portada (tabloid apaisado) + cuerpo impuesto (tabloid
      // imposed con medias cartas dentro).
      const bodyDoc = await PDFDocument.load(imposedBody);
      const bodyCopies = await merged.copyPages(bodyDoc, bodyDoc.getPageIndices());
      for (const p of bodyCopies) merged.addPage(p);
      out = await merged.save();
      log.info(
        { jobId: job.id, totalPages: merged.getPageCount(), bytes: out.length },
        "Portada apaisada + cuerpo impuesto mergeados",
      );
    } else if (isCoverOnlyKind) {
      // Descargar solo la portada. 1 render a carta portrait (8.5×11).
      // El docente la previsualiza para validar antes de marcar el bundle
      // como READY. Si quiere la versión apaisada del cuadernillo
      // completo, usa el botón "Descargar cuadernillo (PDF)" (kind=bundle)
      // que sí produce el pliego apaisado.
      out = await renderLinearPdf(url);
      log.info({ jobId: job.id, bytes: out.length }, "PDF cover-only generado");
    } else {
      // Flujo legacy: booklet / answer-sheets / answer-key / sus -bundle.
      // 1 render + imposeBooklet (coverPages: 0 — toda la página es body).
      const linear = await renderLinearPdf(url);
      log.info({ jobId: job.id, linearBytes: linear.length }, "PDF lineal generado");
      out = await imposeBooklet(linear, { coverPages: 0 });
      log.info({ jobId: job.id, bytes: out.length }, "Imposición aplicada");
    }

    const dir = path.join(env.STORAGE_DIR, "pdf", institutionId);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${targetId}-${kind}.pdf`);
    await writeFile(filePath, out);

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
