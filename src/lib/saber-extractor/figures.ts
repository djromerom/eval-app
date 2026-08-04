import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { PDFDocument } from "pdf-lib";
import { detectLayout, pickRegion, type LayoutOptions, type LayoutRegion } from "./layout";
import type { AiClient } from "./provider";
import { FIGURE_CHECK_TOOL, imageBlock } from "./provider";
import { FIGURE_CHECK_SYSTEM } from "./prompts";
import { BBoxSchema } from "./types";
import type { BBox, Context, ExtractedFigure, ExtractedQuestion, Figure } from "./types";

const run = promisify(execFile);

/**
 * Resuelve la ruta absoluta de un binario externo (`pdfimages`,
 * `pdftoppm`). Busca primero en `$PATH` y luego en una lista de
 * ubicaciones conocidas de Homebrew/system. Misma lógica que
 * `pythonPath()` en `layout.ts` para el intérprete de Python: ser
 * robustos en el path de despliegue sin pedirle al operador que
 * edite env vars. En shells no-login (típicos de procesos PM2, IDE
 * y subprocess hijos de Claude Code) `/opt/homebrew/bin` no está
 * en PATH aunque `brew install poppler` haya dejado los binarios ahí.
 */
function resolveBin(name: string): string {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(":")) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  for (const dir of ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return name;
}

/* ------------------------------------------------------------------ */
/*  Numeración global                                                  */
/* ------------------------------------------------------------------ */

/**
 * El modelo numera las figuras por chunk ([IMAGEN 1], [IMAGEN 2], ...) y cada
 * chunk es una llamada independiente, así que esa numeración NO es única en el
 * documento: dos chunks distintos producen dos "[IMAGEN 1]" diferentes. Además
 * los chunks se solapan, por lo que una misma figura puede llegar dos veces con
 * refs distintas.
 *
 * Este registro asigna un id único y estable por figura ("p04-fig1"), usando la
 * página absoluta del PDF, y deduplica las repeticiones por solapamiento.
 */
export class FigureRegistry {
  private readonly byPage = new Map<number, Figure[]>();

  /** Registra (o reencuentra) una figura y devuelve su id global. */
  add(page: number, bbox: BBox, caption: string | null): string {
    const onPage = this.byPage.get(page) ?? [];
    for (const existing of onPage) {
      if (iou(existing.bbox, bbox) > 0.5) {
        // Misma figura vista en otro chunk: conserva la primera, pero quédate
        // con la descripción más informativa.
        if (!existing.caption && caption) existing.caption = caption;
        return existing.id;
      }
    }
    const fig: Figure = {
      id: `p${String(page).padStart(2, "0")}-fig${onPage.length + 1}`,
      page,
      bbox: clampBox(bbox),
      caption,
      file: null,
      source: "pending",
      verified: "unchecked",
    };
    onPage.push(fig);
    this.byPage.set(page, onPage);
    return fig.id;
  }

  /** Todas las figuras, ordenadas por página y luego por aparición. */
  all(): Figure[] {
    return [...this.byPage.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, figs]) => figs);
  }

  /** Figuras de una página concreta. */
  onPage(page: number): Figure[] {
    return this.byPage.get(page) ?? [];
  }
}

/** Reescribe "[IMAGEN 4" y "!!IMAGEN 4!!" usando el mapa ref → id global. */
export function rewriteRefs(text: string, map: Map<number, string>): string {
  return text
    .replace(/!!\s*IMAGEN\s+(\d+)\s*!!/gi, (whole, n: string) => {
      const id = map.get(Number(n));
      return id ? `!!IMAGEN ${id}!!` : whole;
    })
    .replace(/\[IMAGEN\s+(\d+)/gi, (whole, n: string) => {
      const id = map.get(Number(n));
      return id ? `[IMAGEN ${id}` : whole;
    });
}

/**
 * Convierte las figuras locales de UN chunk en ids globales y reescribe todas
 * las referencias de sus preguntas y contextos. Muta `questions` y `contexts`.
 *
 * @param chunkPages Páginas absolutas del chunk, en orden (`PdfChunk.pages`).
 */
export function globalizeFigures(
  registry: FigureRegistry,
  figures: ExtractedFigure[],
  questions: ExtractedQuestion[],
  contexts: Context[],
  chunkPages: number[],
): void {
  const refToId = new Map<number, string>();
  for (const f of figures) {
    const absPage = chunkPages[f.page - 1];
    if (absPage === undefined) continue; // el modelo inventó una página
    refToId.set(f.ref, registry.add(absPage, f.bbox, f.caption));
  }
  if (refToId.size === 0) return;

  for (const q of questions) {
    q.text = rewriteRefs(q.text, refToId);
    if (q.imagePlaceholder) {
      q.imagePlaceholder = rewriteRefs(q.imagePlaceholder, refToId);
    }
  }
  for (const c of contexts) {
    c.text = rewriteRefs(c.text, refToId);
  }
}

/** Extrae el id de figura de un placeholder ya globalizado. */
export function figureIdFromPlaceholder(placeholder: string | null): string | null {
  if (!placeholder) return null;
  const m = /!!\s*IMAGEN\s+([\w-]+)\s*!!/i.exec(placeholder);
  return m?.[1] ?? null;
}

/**
 * Ids de figura referenciados dentro de un texto, en orden de aparición.
 *
 * Hace falta porque el modelo no siempre llena `imagePlaceholder` en la
 * pregunta: cuando la figura pertenece a la lectura compartida, a veces solo
 * la menciona en el texto del contexto. Leer las referencias del contexto
 * recupera el vínculo sin depender de que el modelo sea consistente.
 */
export function figureIdsInText(text: string): string[] {
  const ids: string[] = [];
  const re = /\[IMAGEN\s+([\w-]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const id = m[1];
    // Solo ids globalizados ("p04-fig1"), no numeración cruda sin resolver.
    if (id && /^p\d+-fig\d+$/i.test(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/* ------------------------------------------------------------------ */
/*  Inventario de imágenes incrustadas (pdfimages -list)               */
/* ------------------------------------------------------------------ */

export interface EmbeddedImage {
  page: number;
  /**
   * Índice DENTRO de la página. `pdfimages` reinicia la numeración cuando se
   * limita a una página (`-f P -l P`), así que este índice —y no la columna
   * `num` global— es el que coincide con el sufijo del archivo extraído.
   */
  num: number;
  type: string;
  width: number;
  height: number;
  objectId: string;
  xPpi: number;
  yPpi: number;
}

/**
 * Parsea la salida de `pdfimages -list`. Ojo con las columnas: la cabecera dice
 * "object ID" pero poppler imprime DOS valores ahí (número de objeto y
 * generación), así que x-ppi/y-ppi caen en los índices 12 y 13, no en 11 y 12.
 *
 *   page num type width height color comp bpc enc interp obj gen x-ppi y-ppi size ratio
 *      1   0 image   261     24   rgb    3   8 jpeg    yes  21   0    96    92 2184B  12%
 */
function parseImageList(stdout: string): EmbeddedImage[] {
  const out: EmbeddedImage[] = [];
  const seenPerPage = new Map<number, number>();
  for (const line of stdout.split("\n")) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 16) continue;
    const page = Number(cols[0]);
    if (!Number.isFinite(page) || !Number.isFinite(Number(cols[1]))) continue;
    const num = seenPerPage.get(page) ?? 0;
    seenPerPage.set(page, num + 1);
    out.push({
      page,
      num,
      type: cols[2] ?? "",
      width: Number(cols[3]),
      height: Number(cols[4]),
      objectId: cols[10] ?? "",
      xPpi: Number(cols[12]),
      yPpi: Number(cols[13]),
    });
  }
  return out;
}

/** Inventario crudo de imágenes incrustadas del PDF, vía `pdfimages -list`. */
export async function listEmbeddedImages(pdfPath: string): Promise<EmbeddedImage[]> {
  const { stdout } = await run(resolveBin("pdfimages"), ["-list", pdfPath], {
    maxBuffer: 32 * 1024 * 1024,
  });
  return parseImageList(stdout);
}

/** Tamaño de cada página del PDF, en puntos. */
async function pageSizes(bytes: Uint8Array): Promise<Array<{ width: number; height: number }>> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => {
    const { width, height } = p.getSize();
    return { width, height };
  });
}

/** Área mínima (px²) para considerar que una imagen es una figura y no un adorno. */
const MIN_FIGURE_AREA = 100 * 100;

/**
 * Decide qué imágenes incrustadas son figuras reales. Descarta:
 *  - máscaras de transparencia (`smask`, `mask`), que no son imágenes visibles;
 *  - imágenes diminutas (viñetas, iconos);
 *  - el mismo objeto repetido en muchas páginas (logos y encabezados);
 *  - escaneos de página completa, que no son una figura sino la página entera.
 */
export function classifyEmbedded(
  images: EmbeddedImage[],
  pages: Array<{ width: number; height: number }>,
): Map<number, EmbeddedImage[]> {
  const pagesWithObject = new Map<string, Set<number>>();
  for (const img of images) {
    const set = pagesWithObject.get(img.objectId) ?? new Set<number>();
    set.add(img.page);
    pagesWithObject.set(img.objectId, set);
  }
  // Un logo aparece en casi todas las páginas; una figura real, casi nunca.
  const repeatLimit = Math.max(3, Math.ceil(pages.length * 0.5));

  const byPage = new Map<number, EmbeddedImage[]>();
  for (const img of images) {
    if (img.type !== "image") continue;
    if (img.width * img.height < MIN_FIGURE_AREA) continue;
    if ((pagesWithObject.get(img.objectId)?.size ?? 0) >= repeatLimit) continue;
    if (coversWholePage(img, pages[img.page - 1])) continue;
    const list = byPage.get(img.page) ?? [];
    list.push(img);
    byPage.set(img.page, list);
  }
  for (const list of byPage.values()) list.sort((a, b) => a.num - b.num);
  return byPage;
}

/**
 * ¿La imagen ocupa prácticamente toda la página? Se compara el tamaño impreso
 * (px / ppi → pulgadas → puntos) con el de la página. Así se detecta un PDF
 * escaneado, donde cada página es un único JPEG y no hay figuras que extraer.
 */
function coversWholePage(
  img: EmbeddedImage,
  page: { width: number; height: number } | undefined,
): boolean {
  if (!page || !img.xPpi || !img.yPpi) return false;
  const wPt = (img.width / img.xPpi) * 72;
  const hPt = (img.height / img.yPpi) * 72;
  return wPt / page.width >= 0.9 && hPt / page.height >= 0.9;
}

/* ------------------------------------------------------------------ */
/*  Materialización a disco                                            */
/* ------------------------------------------------------------------ */

export interface VerifyOptions {
  client: AiClient;
  model: string;
  /** Resolución de la página que se manda a verificar (def. 110). */
  pageDpi?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface MaterializeOptions {
  pdfPath: string;
  pdfBytes: Uint8Array;
  outDir: string;
  /** Resolución de render para los recortes (def. 200). */
  dpi?: number;
  /** Margen extra alrededor del bbox, en fracción de página (def. 0.02). */
  padding?: number;
  /** Si se pasa, usa el detector de layout para ajustar las cajas. */
  layout?: LayoutOptions;
  /** Si se pasa, revisa visualmente cada recorte y corrige los que salieron mal. */
  verify?: VerifyOptions;
  onProgress?: (done: number, total: number) => void;
}

export interface MaterializeResult {
  figures: Figure[];
  embedded: number;
  /** Recortadas con la caja del detector de layout. */
  detected: number;
  cropped: number;
  failed: number;
  /** Recortes que la verificación tuvo que corregir. */
  corrected: number;
  /** Motivo de cada figura que no se pudo escribir o verificar. */
  warnings: string[];
}

/**
 * Escribe cada figura como PNG en `outDir`, con estrategia híbrida por página:
 *
 *  - Si la página tiene EXACTAMENTE tantas imágenes incrustadas como figuras
 *    detectó el modelo, se extraen tal cual del PDF (exacto y sin re-render).
 *  - En cualquier otro caso —página escaneada, una figura partida en varias
 *    imágenes, o desacuerdo en el conteo— se renderiza la página y se recorta
 *    por bbox, que es lo seguro.
 */
export async function materializeFigures(
  figures: Figure[],
  opts: MaterializeOptions,
): Promise<MaterializeResult> {
  const { pdfPath, pdfBytes, outDir, dpi = 200, padding = 0.02 } = opts;
  if (figures.length === 0) {
    return {
      figures,
      embedded: 0,
      detected: 0,
      cropped: 0,
      failed: 0,
      corrected: 0,
      warnings: [],
    };
  }
  await assertPoppler();
  await mkdir(outDir, { recursive: true });

  const pages = await pageSizes(pdfBytes);
  const embeddedByPage = classifyEmbedded(await listEmbeddedImages(pdfPath), pages);

  const byPage = new Map<number, Figure[]>();
  for (const f of figures) {
    const list = byPage.get(f.page) ?? [];
    list.push(f);
    byPage.set(f.page, list);
  }

  let embedded = 0;
  let cropped = 0;
  let detected = 0;
  let failed = 0;
  let done = 0;
  const warnings: string[] = [];

  // El detector de layout solo hace falta en las páginas que van a recorte: las
  // que se copian tal cual del PDF ya salen exactas. Se pide todo en UNA
  // llamada porque cargar el modelo cuesta más que analizar cada página.
  let layoutByPage = new Map<number, LayoutRegion[]>();
  if (opts.layout) {
    const cropPages = [...byPage.entries()]
      .filter(([page, figs]) => {
        const c = embeddedByPage.get(page) ?? [];
        return !(c.length > 0 && c.length === figs.length);
      })
      .map(([page]) => page);
    if (cropPages.length > 0) {
      try {
        layoutByPage = await detectLayout(pdfPath, cropPages, opts.layout);
      } catch (err) {
        warnings.push(
          `detector de layout no disponible, se usa el bbox del modelo ` +
            `(${err instanceof Error ? err.message : String(err)})`,
        );
      }
    }
  }

  /** Región ya asignada → figura que se la quedó, para detectar duplicados. */
  const claimed = new Map<LayoutRegion, string>();

  for (const [page, figs] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    const candidates = embeddedByPage.get(page) ?? [];
    // Solo si hay correspondencia 1:1 se puede emparejar por orden de lectura.
    // Si no coinciden los conteos (página escaneada, o una figura partida en
    // varias imágenes) se recorta, que nunca empareja mal.
    const canUseEmbedded = candidates.length > 0 && candidates.length === figs.length;

    for (const [i, fig] of figs.entries()) {
      try {
        if (canUseEmbedded) {
          await extractEmbedded(pdfPath, page, candidates[i]!.num, outDir, fig.id);
          fig.source = "embedded";
          embedded++;
        } else {
          // Si el detector encontró la figura, su caja manda: la del LLM solo
          // sirve para saber CUÁL de las regiones detectadas es esta figura.
          const region = pickRegion(fig.bbox, layoutByPage.get(page) ?? []);
          if (region) {
            // Dos figuras que caen en la MISMA región detectada son casi seguro
            // la misma figura vista en dos chunks solapados, que el dedupe por
            // IoU no alcanzó a unir. Se avisa en vez de fingir que son dos.
            const owner = claimed.get(region);
            if (owner) {
              warnings.push(
                `${fig.id} apunta a la misma región que ${owner} (pág ${page}): ` +
                  `probablemente sean la misma figura duplicada`,
              );
            } else {
              claimed.set(region, fig.id);
            }
          }
          const box = region ? region.bbox : fig.bbox;
          const pad = region ? Math.min(padding, 0.006) : padding;
          await cropRegion(pdfPath, page, box, pages[page - 1], outDir, fig.id, dpi, pad);
          if (region) {
            fig.bbox = clampBox(box);
            fig.source = "detected";
            detected++;
          } else {
            fig.source = "crop";
            cropped++;
          }
        }
        fig.file = `${fig.id}.png`;
      } catch (err) {
        fig.file = null;
        failed++;
        warnings.push(
          `${fig.id} (pág ${page}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      opts.onProgress?.(++done, figures.length);
    }
  }

  let corrected = 0;
  if (opts.verify) {
    corrected = await verifyCrops(figures, pages, warnings, {
      ...opts,
      verify: opts.verify,
    });
  }

  return { figures, embedded, detected, cropped, failed, corrected, warnings };
}

/**
 * Segunda pasada: le muestra al modelo la página y el recorte, y le pregunta si
 * la figura quedó completa. Estimar un bbox a ciegas es difícil; ver que un
 * recorte quedó cortado es fácil, así que este pase corrige justo los errores
 * que la primera pasada no puede evitar.
 *
 * Solo revisa los recortes: las imágenes incrustadas salen exactas del PDF y no
 * hay nada que verificar. Se hace UNA corrección por figura, no se itera.
 */
async function verifyCrops(
  figures: Figure[],
  pages: Array<{ width: number; height: number }>,
  warnings: string[],
  opts: MaterializeOptions & { verify: VerifyOptions },
): Promise<number> {
  const { pdfPath, outDir, dpi = 200, padding = 0.02, verify } = opts;
  // Las cajas del detector no se mandan a verificar: son mejores que lo que el
  // LLM pueda opinar de ellas, y ya vimos que "corrigiendo" llega a estropearlas.
  const targets = figures.filter((f) => f.source === "crop" && f.file);
  if (targets.length === 0) return 0;

  const pageCache = new Map<number, string>();
  let corrected = 0;
  let done = 0;

  for (const fig of targets) {
    try {
      let pagePng = pageCache.get(fig.page);
      if (pagePng === undefined) {
        pagePng = await renderPage(pdfPath, fig.page, verify.pageDpi ?? 110, outDir);
        pageCache.set(fig.page, pagePng);
      }
      const cropPng = (await readFile(join(outDir, `${fig.id}.png`))).toString("base64");

      const msg = await verify.client.createMessage({
        model: verify.model,
        max_tokens: 1024,
        system: FIGURE_CHECK_SYSTEM,
        tools: [FIGURE_CHECK_TOOL],
        tool_choice: { type: "tool", name: FIGURE_CHECK_TOOL.name },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `PÁGINA ${fig.page} completa:` },
              imageBlock(pagePng),
              { type: "text", text: "RECORTE que se hizo de esa página:" },
              imageBlock(cropPng),
              {
                // A propósito NO se le dice qué bbox se usó: si se le da, tiende
                // a devolverlo tal cual y la "corrección" queda en nada.
                type: "text",
                text:
                  `El recorte debería contener esta figura: ` +
                  `${fig.caption ?? "(sin descripción)"}\n` +
                  `¿Se ve la figura entera?`,
              },
            ],
          },
        ],
      });

      const raw = msg.firstToolInput(FIGURE_CHECK_TOOL.name) as {
        complete?: unknown;
        bbox?: unknown;
        reason?: unknown;
      } | null;

      if (raw?.complete === true || raw == null) {
        fig.verified = "ok";
      } else {
        const parsed = BBoxSchema.safeParse(raw.bbox);
        const why = typeof raw.reason === "string" ? ` (${raw.reason})` : "";
        if (!parsed.success) {
          // Dijo que está mal pero no dio una caja usable: se deja el recorte
          // original y se avisa, en vez de romperlo con datos inventados.
          fig.verified = "flagged";
          warnings.push(
            `${fig.id}: marcado incompleto pero sin bbox utilizable; revísalo a mano${why}`,
          );
        } else if (iou(fig.bbox, clampBox(parsed.data)) > 0.9) {
          // Devolvió prácticamente la misma caja: no hay corrección real que
          // aplicar, y anunciarla como "corregida" sería mentir en la salida.
          fig.verified = "flagged";
          warnings.push(
            `${fig.id}: marcado incompleto pero el bbox propuesto es igual al actual; revísalo a mano${why}`,
          );
        } else {
          await cropRegion(
            pdfPath,
            fig.page,
            parsed.data,
            pages[fig.page - 1],
            outDir,
            fig.id,
            dpi,
            padding,
          );
          fig.bbox = clampBox(parsed.data);
          fig.verified = "corrected";
          corrected++;
        }
      }
    } catch (err) {
      // Un fallo de verificación no debe invalidar un recorte ya escrito.
      fig.verified = "unchecked";
      warnings.push(
        `${fig.id}: no se pudo verificar (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    verify.onProgress?.(++done, targets.length);
  }

  return corrected;
}

/** Renderiza una página completa a PNG y la devuelve en base64. */
async function renderPage(
  pdfPath: string,
  page: number,
  dpi: number,
  tmpDir: string,
): Promise<string> {
  const prefix = join(tmpDir, `.page-${page}`);
  await run(resolveBin("pdftoppm"), [
    "-png",
    "-r",
    String(dpi),
    "-f",
    String(page),
    "-l",
    String(page),
    pdfPath,
    prefix,
  ]);
  const produced = (await readdir(tmpDir)).filter((f) => f.startsWith(`.page-${page}-`));
  const first = produced[0];
  if (first === undefined) throw new Error(`no se pudo renderizar la página ${page}`);
  const b64 = (await readFile(join(tmpDir, first))).toString("base64");
  await Promise.all(produced.map((f) => rm(join(tmpDir, f), { force: true })));
  return b64;
}

/** Extrae la imagen `num` de una página concreta y la renombra a `<id>.png`. */
async function extractEmbedded(
  pdfPath: string,
  page: number,
  num: number,
  outDir: string,
  id: string,
): Promise<void> {
  const prefix = join(outDir, `.tmp-${id}`);
  await run(resolveBin("pdfimages"), [
    "-png",
    "-f",
    String(page),
    "-l",
    String(page),
    pdfPath,
    prefix,
  ]);
  // Al limitar a una página, el sufijo del archivo reinicia en 000 y coincide
  // con la columna `num` de `pdfimages -list -f P -l P`.
  const produced = (await readdir(outDir)).filter((f) => f.startsWith(`.tmp-${id}-`));
  const wanted = `.tmp-${id}-${String(num).padStart(3, "0")}.png`;
  if (!produced.includes(wanted)) {
    await Promise.all(produced.map((f) => rm(join(outDir, f), { force: true })));
    throw new Error(`pdfimages no produjo ${wanted}`);
  }
  await rename(join(outDir, wanted), join(outDir, `${id}.png`));
  await Promise.all(
    produced.filter((f) => f !== wanted).map((f) => rm(join(outDir, f), { force: true })),
  );
}

/** Renderiza la página a `dpi` y recorta la región del bbox (con margen). */
async function cropRegion(
  pdfPath: string,
  page: number,
  bbox: BBox,
  size: { width: number; height: number } | undefined,
  outDir: string,
  id: string,
  dpi: number,
  padding: number,
): Promise<void> {
  if (!size) throw new Error(`Página ${page} fuera de rango`);
  const [x0, y0, x1, y1] = clampBox([
    bbox[0] - padding,
    bbox[1] - padding,
    bbox[2] + padding,
    bbox[3] + padding,
  ]);

  const pxW = Math.round((size.width / 72) * dpi);
  const pxH = Math.round((size.height / 72) * dpi);
  const x = Math.round(x0 * pxW);
  const y = Math.round(y0 * pxH);
  const w = Math.max(1, Math.round((x1 - x0) * pxW));
  const h = Math.max(1, Math.round((y1 - y0) * pxH));

  const prefix = join(outDir, `.tmp-${id}`);
  await run(resolveBin("pdftoppm"), [
    "-png",
    "-r",
    String(dpi),
    "-f",
    String(page),
    "-l",
    String(page),
    "-x",
    String(x),
    "-y",
    String(y),
    "-W",
    String(w),
    "-H",
    String(h),
    pdfPath,
    prefix,
  ]);
  // pdftoppm sufija con el número de página, con ancho variable según el total.
  const produced = (await readdir(outDir)).filter((f) => f.startsWith(`.tmp-${id}-`));
  const first = produced[0];
  if (first === undefined) throw new Error("pdftoppm no produjo ningún archivo");
  await rename(join(outDir, first), join(outDir, `${id}.png`));
  await Promise.all(produced.slice(1).map((f) => rm(join(outDir, f), { force: true })));
}

let popplerChecked = false;

/** Falla con un mensaje accionable si poppler no está instalado. */
async function assertPoppler(): Promise<void> {
  if (popplerChecked) return;
  for (const bin of ["pdfimages", "pdftoppm"]) {
    try {
      await run(resolveBin(bin), ["-v"]);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Falta "${bin}" (poppler), necesario para extraer imágenes. ` +
          `Detalle: ${detail}. ` +
          `Instálalo con "brew install poppler" o usa el pipeline sin --images.`,
      );
    }
  }
  popplerChecked = true;
}

/* ------------------------------------------------------------------ */
/*  Utilidades geométricas                                             */
/* ------------------------------------------------------------------ */

function clampBox(b: BBox): BBox {
  const x0 = Math.min(Math.max(b[0], 0), 1);
  const y0 = Math.min(Math.max(b[1], 0), 1);
  const x1 = Math.min(Math.max(b[2], 0), 1);
  const y1 = Math.min(Math.max(b[3], 0), 1);
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}

/** Intersección sobre unión: mide si dos cajas son "la misma" figura. */
function iou(a: BBox, b: BBox): number {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  if (inter === 0) return 0;
  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}
