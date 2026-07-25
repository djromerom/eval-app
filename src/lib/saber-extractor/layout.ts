import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { BBox } from "./types";

const run = promisify(execFile);

/**
 * Puente al detector de layout en Python (`python/detect_layout.py`).
 *
 * El bbox que estima el LLM sirve para saber QUÉ figura es y a qué pregunta
 * pertenece, pero no para recortarla: es impreciso y arrastra texto. El
 * detector, entrenado para esto, aporta la geometría; el bbox del LLM se usa
 * solo para emparejar cada región detectada con la figura que le corresponde.
 */

export interface LayoutRegion {
  /** Etiqueta del modelo: figure, table, plain text, title, abandon... */
  label: string;
  score: number;
  bbox: BBox;
}

export interface LayoutOptions {
  /** Resolución de rasterizado para el detector (def. 150). */
  dpi?: number;
  /** Confianza mínima (def. 0.25). */
  conf?: number;
  /** Intérprete de Python. Por defecto el venv del proyecto, si existe. */
  python?: string;
}

/** Etiquetas que cuentan como "figura recortable". */
const FIGURE_LABELS = new Set(["figure", "table", "isolate_formula"]);

function packageRoot(): string {
  // dist/layout.js o src/layout.ts → raíz del paquete.
  //
  // Antes: `dirname(fileURLToPath(import.meta.url))`. Reemplazado por
  // `__filename` para poder compilar bajo DOS tsconfigs distintos:
  //   - tsconfig.json → module: "esnext"   (Next.js app)   → import.meta OK
  //   - tsconfig.worker.json → module: "commonjs" (workers) → import.meta NO
  // El worker `question-extract` importa `saber-extractor-parser` (que
  // importa este módulo) y TS1343 rechaza `import.meta` en commonjs.
  // `__filename` es un global reconocido en ambos targets (Node CJS lo
  // expone nativamente; Next/webpack lo polyfillea para el bundle ESM).
  return resolve(dirname(__filename), "..");
}

/** Intérprete a usar: el venv del proyecto, SABER_PYTHON, o python3 del PATH. */
export function pythonPath(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.SABER_PYTHON) return process.env.SABER_PYTHON;
  const venv = join(packageRoot(), "python", ".venv", "bin", "python");
  return existsSync(venv) ? venv : "python3";
}

function scriptPath(): string {
  return join(packageRoot(), "python", "detect_layout.py");
}

/** ¿Están listas las dependencias de Python? No lanza: devuelve el motivo. */
export async function layoutAvailable(
  opts: LayoutOptions = {},
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const script = scriptPath();
  if (!existsSync(script)) {
    return { ok: false, reason: `no se encontró ${script}` };
  }
  try {
    const { stdout } = await run(
      pythonPath(opts.python),
      [script, "--pdf", "x", "--pages", "1", "--check"],
      { timeout: 60_000 },
    );
    const parsed = JSON.parse(stdout) as { ok?: boolean; error?: string };
    return parsed.ok === true
      ? { ok: true }
      : { ok: false, reason: parsed.error ?? "respuesta inesperada" };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Detecta las regiones de las páginas indicadas. Se llama UNA vez con todas las
 * páginas: cargar el modelo cuesta más que analizar cada página.
 */
export async function detectLayout(
  pdfPath: string,
  pages: number[],
  opts: LayoutOptions = {},
): Promise<Map<number, LayoutRegion[]>> {
  const out = new Map<number, LayoutRegion[]>();
  const unique = [...new Set(pages)].sort((a, b) => a - b);
  if (unique.length === 0) return out;

  const args = [
    scriptPath(),
    "--pdf",
    pdfPath,
    "--pages",
    unique.join(","),
    "--dpi",
    String(opts.dpi ?? 150),
    "--conf",
    String(opts.conf ?? 0.25),
  ];
  const { stdout } = await run(pythonPath(opts.python), args, {
    maxBuffer: 64 * 1024 * 1024,
    // La primera vez descarga ~75 MB de pesos.
    timeout: 600_000,
  });

  const parsed = JSON.parse(stdout) as {
    ok: boolean;
    error?: string;
    pages?: Record<string, LayoutRegion[]>;
  };
  if (!parsed.ok) throw new Error(parsed.error ?? "el detector falló");

  for (const [page, regions] of Object.entries(parsed.pages ?? {})) {
    out.set(Number(page), regions);
  }
  return out;
}

/**
 * Elige la región detectada que corresponde a `seed`.
 *
 * El criterio es cuánto de la región cae dentro de la semilla del LLM: la
 * semilla suele ser más grande y estar algo desplazada, así que exigir IoU alto
 * fallaría. Además, así los falsos positivos lejanos —una caja de "Respuesta"
 * detectada como figura— se descartan solos por no solaparse.
 */
export function pickRegion(
  seed: BBox,
  regions: LayoutRegion[],
  minContainment = 0.35,
): LayoutRegion | null {
  let best: LayoutRegion | null = null;
  let bestScore = 0;
  for (const r of regions) {
    if (!FIGURE_LABELS.has(r.label)) continue;
    const inter = intersection(seed, r.bbox);
    if (inter <= 0) continue;
    const area = boxArea(r.bbox);
    if (area <= 0) continue;
    const containment = inter / area;
    if (containment < minContainment) continue;
    // A igualdad de solape, manda la confianza del detector.
    const score = containment + r.score * 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

function intersection(a: BBox, b: BBox): number {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
}

function boxArea(b: BBox): number {
  return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
}
