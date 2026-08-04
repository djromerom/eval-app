#!/usr/bin/env node
import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { extractExam, type ProgressEvent } from "./pipeline";
import type { ProviderType } from "./provider";

interface CliArgs {
  pdf?: string;
  out?: string;
  provider: ProviderType;
  chunkSize?: number;
  overlap?: number;
  solveBatch?: number;
  extractModel?: string;
  solveModel?: string;
  noSolve: boolean;
  hydrate: boolean;
  parallel: boolean;
  audit: boolean;
  images: boolean;
  imagesDir?: string;
  imagesDpi?: number;
  verifyImages: boolean;
  layout: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const a: CliArgs = {
    provider: (process.env.SABER_PROVIDER as ProviderType) ?? "anthropic",
    noSolve: false,
    hydrate: false,
    parallel: false,
    audit: false,
    images: false,
    verifyImages: false,
    layout: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = () => argv[++i]!;
    /** Lee un entero >= min y falla ruidosamente si no lo es. */
    const num = (min: number) => {
      const raw = next();
      const n = Number(raw);
      if (!Number.isInteger(n) || n < min) {
        throw new Error(`${arg} espera un entero >= ${min} (recibí "${raw}").`);
      }
      return n;
    };
    switch (arg) {
      case "-h":
      case "--help":
        a.help = true;
        break;
      case "-o":
      case "--out":
        a.out = next();
        break;
      case "--provider":
        a.provider = next() as ProviderType;
        break;
      case "--chunk-size":
        a.chunkSize = num(1);
        break;
      case "--overlap":
        a.overlap = num(0);
        break;
      case "--solve-batch":
        a.solveBatch = num(1);
        break;
      case "--extract-model":
        a.extractModel = next();
        break;
      case "--solve-model":
        a.solveModel = next();
        break;
      case "--no-solve":
        a.noSolve = true;
        break;
      case "--hydrate":
        a.hydrate = true;
        break;
      case "--parallel":
        a.parallel = true;
        break;
      case "--audit":
        a.audit = true;
        break;
      case "--images":
        a.images = true;
        break;
      case "--images-dir":
        a.imagesDir = next();
        a.images = true;
        break;
      case "--images-dpi":
        a.imagesDpi = num(36);
        a.images = true;
        break;
      case "--verify-images":
        a.verifyImages = true;
        a.images = true;
        break;
      case "--layout":
        a.layout = true;
        a.images = true;
        break;
      default:
        if (!arg.startsWith("-") && !a.pdf) a.pdf = arg;
    }
  }
  return a;
}

const HELP = `saber-extract — extrae contextos, preguntas y respuestas de un examen PDF.

Uso:
  saber-extract <examen.pdf> [opciones]

Opciones:
  -o, --out <archivo>         Ruta de salida JSON (por defecto: <pdf>.json)
  --provider <nombre>         Proveedor AI: anthropic | minimax (def. anthropic)
  --chunk-size <n>            Páginas por chunk de extracción (def. 5)
  --overlap <n>               Solapamiento entre chunks (def. 1)
  --solve-batch <n>           Preguntas por llamada al resolver (def. 8)
  --extract-model <id>        Modelo de extracción (def. según provider)
  --solve-model <id>          Modelo de resolución (def. según provider)
  --no-solve                  No resolver respuestas (solo estructura)
  --hydrate                   Copiar el texto del contexto dentro de cada pregunta
  --parallel                  Extraer chunks en paralelo (cuidado con rate limits)
  --audit                     Guardar también <out>.audit.json
  --images                    Extraer las figuras a PNG y referenciarlas en el JSON
  --images-dir <carpeta>      Carpeta de las figuras (def. <out>-imagenes/)
  --images-dpi <n>            Resolución de los recortes (def. 200)
  --layout                    Ajustar las figuras con el detector de layout
  --verify-images             Revisar los recortes con el modelo (ver README)
  -h, --help                  Mostrar esta ayuda

Las imágenes se extraen con estrategia híbrida: si la página trae las figuras
incrustadas se copian tal cual del PDF; si es un escaneo o la figura está partida
en varias imágenes, se renderiza la página y se recorta. Con --layout, la caja
del recorte la da un detector de layout (DocLayout-YOLO) en vez del LLM, que es
bastante más preciso. Requiere poppler (pdfimages y pdftoppm): brew install
poppler; y para --layout, el venv de python/ (ver README).

Variables de entorno:
  ANTHROPIC_API_KEY            Clave API de Anthropic
  MINIMAX_API_KEY              Clave API de MiniMax
  MINIMAX_BASE_URL             Base URL de MiniMax (def. https://api.minimax.io/anthropic/v1)
  SABER_PROVIDER               Proveedor por defecto (anthropic | minimax)
  SABER_EXTRACT_MODEL          Modelo de extracción
  SABER_SOLVE_MODEL            Modelo de resolución`;

function logProgress(ev: ProgressEvent): void {
  switch (ev.phase) {
    case "split":
      console.error(`• ${ev.totalPages} páginas → ${ev.chunks} chunks`);
      break;
    case "extract":
      console.error(`  · extrayendo chunk ${ev.chunk}/${ev.of} (págs ${ev.pages.join(",")})`);
      break;
    case "extract-done":
      console.error(
        `• extracción: ${ev.questions} preguntas, ${ev.contexts} contextos` +
          (ev.missing.length ? `  ⚠ faltantes: ${ev.missing.join(",")}` : ""),
      );
      break;
    case "solve":
      console.error(`• resueltas ${ev.solved}/${ev.of} respuestas`);
      break;
    case "images":
      if (ev.done === 1 || ev.done === ev.of || ev.done % 5 === 0) {
        console.error(`  · figuras ${ev.done}/${ev.of}`);
      }
      break;
    case "images-verify":
      if (ev.done === 1 || ev.done === ev.of || ev.done % 5 === 0) {
        console.error(`  · verificando recortes ${ev.done}/${ev.of}`);
      }
      break;
    case "images-done":
      console.error(
        `• figuras: ${ev.total} (${ev.embedded} incrustadas, ` +
          `${ev.detected} detectadas, ${ev.cropped} recortadas` +
          (ev.corrected ? `, ${ev.corrected} corregidas` : "") +
          (ev.failed ? `, ⚠ ${ev.failed} fallidas` : "") +
          ")",
      );
      for (const w of ev.warnings) console.error(`  ⚠ ${w}`);
      break;
    case "assemble":
      console.error(`• ensamblado: ${ev.questions} preguntas`);
      break;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.pdf) {
    console.log(HELP);
    process.exit(args.pdf ? 0 : 1);
  }

  const outPath = args.out ?? `${args.pdf.replace(/\.pdf$/i, "")}.json`;

  // Las rutas del JSON son relativas al propio JSON, para que la carpeta de
  // imágenes se pueda mover junto a él.
  const outBase = basename(outPath).replace(/\.json$/i, "");
  const imagesDir = args.imagesDir ?? join(dirname(outPath), `${outBase}-imagenes`);
  const jsonPrefix = args.imagesDir
    ? relative(dirname(outPath), args.imagesDir) || "."
    : `${outBase}-imagenes`;

  const result = await extractExam(args.pdf, {
    provider: { type: args.provider },
    models: {
      ...(args.extractModel ? { extractModel: args.extractModel } : {}),
      ...(args.solveModel ? { solveModel: args.solveModel } : {}),
    },
    chunking: {
      ...(args.chunkSize ? { chunkSize: args.chunkSize } : {}),
      ...(args.overlap !== undefined ? { overlap: args.overlap } : {}),
    },
    solve: !args.noSolve,
    solveBatchSize: args.solveBatch,
    hydrateContextText: args.hydrate,
    parallelExtraction: args.parallel,
    ...(args.images
      ? {
          images: {
            dir: imagesDir,
            jsonPrefix,
            verify: args.verifyImages,
            layout: args.layout,
            ...(args.imagesDpi !== undefined ? { dpi: args.imagesDpi } : {}),
          },
        }
      : {}),
    onProgress: logProgress,
  });

  await writeFile(outPath, JSON.stringify(result.output, null, 2), "utf8");
  console.error(`✓ escrito: ${outPath}`);
  if (args.images) console.error(`✓ figuras en: ${imagesDir}/`);

  if (args.audit) {
    const auditPath = outPath.replace(/\.json$/i, "") + ".audit.json";
    await writeFile(
      auditPath,
      JSON.stringify({ contexts: result.output.contexts, questions: result.audited }, null, 2),
      "utf8",
    );
    console.error(`✓ escrito: ${auditPath}`);
  }
}

main().catch((err) => {
  console.error("✗ Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
