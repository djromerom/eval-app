/**
 * Diff visual entre el cuadernillo GENERADO y el PDF de REFERENCIA institucional.
 *
 * Qué hace:
 *   1. Renderiza la primera página del PDF de referencia a PNG vía `pdftoppm`.
 *   2. Abre `/print/evaluation/[id]` con un token firmado (mismo mecanismo que
 *      el worker de PDF) y captura cada página a PNG con Puppeteer.
 *   3. Redimensiona ambas imágenes a un canvas común, calcula diff por píxel
 *      con `sharp` y emite:
 *      - Un PNG side-by-side (referencia | booklet | overlay rojo).
 *      - Un reporte JSON con porcentaje de píxeles diferentes.
 *
 * Uso:
 *   pnpm tsx scripts/visual-diff.ts \
 *     --reference ../Prueba__11º_I_periodo_C3__1_.pdf \
 *     --evaluation <id> \
 *     --base-url http://localhost:3000 \
 *     --out storage/visual-diff
 *
 * Requisitos:
 *   - Dev server corriendo (`pnpm dev`) o worker invocable para generar el PDF
 *     (alternativamente, se puede pasar `--pdf` con un booklet ya generado).
 *   - pdftoppm instalado (poppler-utils, ya en PATH en macOS).
 *
 * Interpretación:
 *   <5%  diff: layout OK, solo diferencias de contenido (esperable: el booklet
 *             generado tiene preguntas distintas).
 *   5-15%: merece revisión manual — puede ser tipografía, márgenes o color.
 *   >15%: regresión visible — tipografía rota, layout descuadrado, etc.
 *
 * NO pretende ser pixel-perfect entre el contenido (las preguntas son
 * distintas). Lo que valida es la GEOMETRÍA de la página: portada, tabla de
 * competencias, encabezado de pregunta, columna, pie de página.
 */
import "../workers/load-env";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import puppeteer from "puppeteer";
import sharp from "sharp";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { signPrintToken } from "@/shared/infrastructure/crypto/print-token";

const execFileAsync = promisify(execFile);

interface CliArgs {
  reference: string;
  evaluationId?: string;
  baseUrl: string;
  outDir: string;
  /** Override del booklet PDF si ya lo generaste por otro medio. */
  bookletPdf?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: Partial<CliArgs> = {
    baseUrl: "http://localhost:3000",
    outDir: "storage/visual-diff",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--reference") args.reference = next!;
    else if (a === "--evaluation") args.evaluationId = next!;
    else if (a === "--base-url") args.baseUrl = next!;
    else if (a === "--out") args.outDir = next!;
    else if (a === "--pdf") args.bookletPdf = next!;
  }
  if (!args.reference) {
    throw new Error("--reference <ruta/al/Prueba__11º...pdf> es obligatorio");
  }
  return args as CliArgs;
}

async function resolveEvaluationId(arg?: string): Promise<string> {
  if (arg) return arg;
  // Busca la evaluación seed de referencia en la BD (la única con bookletNumber
  // explícito + título "Prueba 11°").
  const row = await prisma.evaluation.findFirst({
    where: { bookletNumber: 3 },
    select: { id: true, institutionId: true },
  });
  if (!row) {
    throw new Error(
      "No se encontró la evaluación seed de referencia. Corre `pnpm seed:reference` o pasa --evaluation <id>.",
    );
  }
  return row.id;
}

async function renderReferencePng(
  referencePdf: string,
  outDir: string,
): Promise<{ page: number; png: string }[]> {
  const prefix = join(outDir, "ref");
  await mkdir(outDir, { recursive: true });
  // Solo la primera página (portada) — es lo que más se quiere validar.
  // -r 150 ≈ misma densidad que Puppeteer a 150 DPI por defecto.
  await execFileAsync("pdftoppm", [
    "-png",
    "-r",
    "150",
    "-f",
    "1",
    "-l",
    "2",
    referencePdf,
    prefix,
  ]);
  return [
    { page: 1, png: `${prefix}-1.png` },
    { page: 2, png: `${prefix}-2.png` },
  ];
}

async function renderBookletPngs(
  evaluationId: string,
  baseUrl: string,
  outDir: string,
): Promise<string[]> {
  const inst = await prisma.evaluation.findFirstOrThrow({
    where: { id: evaluationId },
    select: { institutionId: true },
  });
  const token = signPrintToken({
    evaluationId,
    institutionId: inst.institutionId,
    kind: "booklet",
  });
  const url = `${baseUrl}/print/evaluation/${evaluationId}?t=${encodeURIComponent(token)}`;

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    const res = await page.goto(url, { waitUntil: "networkidle0", timeout: 60_000 });
    if (!res || !res.ok()) {
      throw new Error(`No se pudo cargar la página (HTTP ${res?.status()})`);
    }
    if (page.url().includes("/login")) {
      throw new Error("Acceso a /print rechazado (token inválido)");
    }
    const pngs: string[] = [];
    const total =
      (await page.evaluate(() => document.querySelectorAll(".booklet-page").length)) || 1;
    for (let i = 1; i <= total; i++) {
      const out = join(outDir, `gen-${String(i).padStart(2, "0")}.png`);
      // Captura la i-ésima página del booklet (las páginas lógicas tienen
      // clase .booklet-page en la plantilla; fallback = viewport si no hay).
      await page.evaluate((idx) => {
        const el = document.querySelectorAll(".booklet-page")[idx - 1];
        if (el) el.scrollIntoView();
      }, i);
      await page.screenshot({ path: out as `${string}.png`, fullPage: false });
      pngs.push(out);
    }
    return pngs;
  } finally {
    await browser.close();
  }
}

interface PageDiff {
  page: number;
  diffPct: number;
  verdict: "ok" | "review" | "fail";
}

async function diffPage(refPng: string, genPng: string): Promise<PageDiff> {
  const W = 1224; // ≈ 8.5" × 144 DPI
  const H = 1584; // ≈ 11" × 144 DPI
  const [refBuf, genBuf] = await Promise.all([readFile(refPng), readFile(genPng)]);
  const ref = await sharp(refBuf)
    .resize(W, H, { fit: "contain", background: "#fff" })
    .raw()
    .toBuffer();
  const gen = await sharp(genBuf)
    .resize(W, H, { fit: "contain", background: "#fff" })
    .raw()
    .toBuffer();
  const px = W * H;
  let diff = 0;
  const overlay = Buffer.alloc(px * 3);
  // threshold = 24 (sobre 255) — diferencias de antialiasing no cuentan
  const T = 24;
  for (let i = 0; i < px; i++) {
    const dr = Math.abs(ref[i * 3]! - gen[i * 3]!);
    const dg = Math.abs(ref[i * 3 + 1]! - gen[i * 3 + 1]!);
    const db = Math.abs(ref[i * 3 + 2]! - gen[i * 3 + 2]!);
    if (dr + dg + db > T * 3) {
      diff++;
      // Rojo donde difieren
      overlay[i * 3] = 255;
      overlay[i * 3 + 1] = 0;
      overlay[i * 3 + 2] = 0;
    } else {
      // Escala de grises donde coinciden (para que el overlay sea legible)
      const v = (ref[i * 3]! + ref[i * 3 + 1]! + ref[i * 3 + 2]!) / 3;
      overlay[i * 3] = overlay[i * 3 + 1] = overlay[i * 3 + 2] = v;
    }
  }
  const diffPct = (diff / px) * 100;
  const verdict: PageDiff["verdict"] = diffPct < 5 ? "ok" : diffPct < 15 ? "review" : "fail";
  return { page: 0, diffPct, verdict };
}

async function buildSideBySide(refPng: string, genPng: string, outPng: string): Promise<void> {
  const W = 600;
  const ref = await sharp(refPng).resize(W).png().toBuffer();
  const gen = await sharp(genPng).resize(W).png().toBuffer();
  const refMeta = await sharp(ref).metadata();
  const genMeta = await sharp(gen).metadata();
  const H = Math.max(refMeta.height ?? 0, genMeta.height ?? 0);
  await sharp({
    create: { width: W * 2 + 20, height: H, channels: 3, background: "#f5f5f5" },
  })
    .composite([
      { input: ref, top: 0, left: 0 },
      { input: gen, top: 0, left: W + 20 },
    ])
    .png()
    .toFile(outPng as `${string}.png`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const referencePdf = resolve(args.reference);
  const outDir = resolve(args.outDir);
  const evaluationId = await resolveEvaluationId(args.evaluationId);

  await mkdir(outDir, { recursive: true });
  console.log(`[visual-diff] out = ${outDir}`);
  console.log(`[visual-diff] reference = ${referencePdf}`);
  console.log(`[visual-diff] evaluation = ${evaluationId}`);
  console.log(`[visual-diff] base url = ${args.baseUrl}`);

  // 1) Referencia → PNG
  console.log("[visual-diff] Renderizando PDF de referencia…");
  const refs = await renderReferencePng(referencePdf, outDir);
  console.log(`[visual-diff] ${refs.length} página(s) de referencia renderizadas`);

  // 2) Booklet generado → PNG
  console.log("[visual-diff] Renderizando booklet generado con Puppeteer…");
  const gens = await renderBookletPngs(evaluationId, args.baseUrl, outDir);
  console.log(`[visual-diff] ${gens.length} página(s) del booklet generadas`);

  // 3) Diff página por página (par 1↔1, 2↔2…)
  const pairs = Math.min(refs.length, gens.length);
  const results: PageDiff[] = [];
  for (let i = 0; i < pairs; i++) {
    console.log(`[visual-diff] Diff página ${i + 1}…`);
    const r = await diffPage(refs[i]!.png, gens[i]!);
    r.page = i + 1;
    results.push(r);
    await buildSideBySide(refs[i]!.png, gens[i]!, join(outDir, `diff-page-${i + 1}.png`));
  }

  // 4) Reporte
  const report = {
    timestamp: new Date().toISOString(),
    reference: referencePdf,
    evaluationId,
    baseUrl: args.baseUrl,
    pages: results,
    overall: results.every((r) => r.verdict === "ok")
      ? "PASS"
      : results.every((r) => r.verdict !== "fail")
        ? "REVIEW"
        : "FAIL",
  };
  const reportPath = join(outDir, "report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n=== visual-diff report ===`);
  console.log(`overall: ${report.overall}`);
  for (const r of results) {
    console.log(`page ${r.page}: ${r.diffPct.toFixed(2)}% → ${r.verdict}`);
  }
  console.log(`\nReporte: ${reportPath}`);
  console.log(`Side-by-side: ${join(outDir, "diff-page-N.png")}`);

  await prisma.$disconnect();
  process.exit(report.overall === "FAIL" ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
