import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
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
  // Antes: `dirname(fileURLToPath(import.meta.url))`. Reemplado por
  // `__filename` para poder compilar bajo DOS tsconfigs distintos:
  //   - tsconfig.json → module: "esnext"   (Next.js app)   → import.meta OK
  //   - tsconfig.worker.json → module: "commonjs" (workers) → import.meta NO
  // El worker `question-extract` importa `saber-extractor-parser` (que
  // importa este módulo) y TS1343 rechaza `import.meta` en commonjs.
  // `__filename` es un global reconocido en ambos targets (Node CJS lo
  // expone nativamente; Next/webpack lo polyfillea para el bundle ESM).
  return resolve(dirname(__filename), "..");
}

/**
 * Raíz real del paquete `saber-extractor`, resolviendo correctamente en
 * ambos modos de consumo:
 *
 *  - **En el repo (pnpm)** — `eval-app/src/lib/saber-extractor/layout.ts`
 *    vive fuera de la carpeta del paquete; el `@/lib/saber-extractor`
 *    apunta a `src/...`, NO a `node_modules/.../saber-extractor/`. `__filename`
 *    queda en `src/lib/`, así que `packageRoot()` resuelve a un dir que
 *    no contiene el script. `require.resolve("saber-extractor/package.json")`
 *    atraviesa el `node_modules/.pnpm/...` y nos da la raíz real.
 *
 *  - **Paquete publicado (npm)** — `__filename` ya está dentro del paquete
 *    y el require también; ambos coinciden.
 *
 * Devuelve `null` si ninguno puede ubicar el paquete (caso patológico:
 * el módulo está bundleado sin node_modules accesibles, p.ej. Next.js
 * server components que no preservan el virtual FS).
 */
function resolvePackageRoot(): string | null {
  try {
    // `require` está disponible tanto en CJS como en ESM-compiled-to-CJS;
    // tsx y Next/webpack lo exponen vía createRequire cuando hace falta.
    const createRequire = (globalThis as { createRequire?: typeof import("module").createRequire })
      .createRequire;
    const req =
      typeof require === "function"
        ? require
        : createRequire
          ? createRequire(import.meta.url)
          : null;
    if (!req) return null;
    const pkgJson = req.resolve("saber-extractor/package.json");
    return dirname(pkgJson);
  } catch {
    return null;
  }
}

/**
 * Cuando `saber-extractor` se instala con el protocolo `file:` de pnpm,
 * el store es una **copia física** del paquete (no un symlink), así que
 * el `.venv` (que está en la fuente) no es alcanzable desde el path
 * que devuelve `resolvePackageRoot()`. Para resolver el path de la
 * fuente original, decodificamos el nombre del directorio del store:
 *
 *   …/.pnpm/saber-extractor@file+djromero+Solinces+saber-extractor_HASH/node_modules/saber-extractor
 *
 * → `name = saber-extractor`, el source path codificado con `+` como
 *   separador es `djromero/Solinces/saber-extractor`, y el pnpm root
 *   (parent de `node_modules/`) es donde se monta el source relativo.
 *
 * Esto funciona tanto para `file:/abs/path` (pnpm normaliza a relativo
 * al package.json declarante) como para `file:../relative/path`
 * (segmentos `..` se preservan y `path.join` los resuelve). Si la
 * convención de pnpm cambia o el `.venv` no está en la fuente, este
 * helper devuelve `null` y caemos al fallback de `python3`.
 */
function resolveSourceRoot(): string | null {
  const storePackageRoot = resolvePackageRoot();
  if (!storePackageRoot) return null;

  // Subir hasta el directorio `.pnpm` y luego **dos** niveles más:
  // la jerarquía es `<workspace>/node_modules/.pnpm/<entry>/node_modules/<name>`,
  // y el `file:` protocol es relativo al package.json en el `<workspace>`,
  // NO al `node_modules/`. `dirname(dirname(dir))` salta `.pnpm` y
  // su `node_modules` padre.
  let dir = storePackageRoot;
  while (dir !== "/" && basename(dir) !== ".pnpm") dir = dirname(dir);
  if (basename(dir) !== ".pnpm") return null;
  const pnpmRoot = dirname(dirname(dir));

  // Extraer el nombre del entry a partir de
  // `<pnpmRoot>/node_modules/.pnpm/<entry>/node_modules/<name>`.
  const afterPnpm = storePackageRoot.split(`/.pnpm/`)[1];
  if (!afterPnpm) return null;
  const entryDir = afterPnpm.split("/")[0];
  if (!entryDir) return null;

  // Formato: `<name>@<protocol>+<encoded-path>_<hash>`.
  // Solo nos interesa el protocolo `file:`; los demás (portal, git…)
  // no son copias locales y no tienen `.venv` que buscar.
  // El hash usa base-62 (a-z, 0-9), no hex — `[a-z0-9]` para cubrirlo.
  const m = entryDir.match(/^[^@]+@file\+(.+)_[a-z0-9]+$/);
  if (!m) return null;
  // El regex garantiza que m[1] existe; con `noUncheckedIndexedAccess`
  // TS lo ve como `string | undefined`, así que el `!` es seguro.
  const sourceRel = m[1]!.replaceAll("+", "/");
  return join(pnpmRoot, sourceRel);
}

/**
 * Intérprete a usar: el venv del proyecto, SABER_PYTHON, o python3 del PATH.
 *
 * Orden de búsqueda:
 *  1. Argumento explícito del caller.
 *  2. `SABER_PYTHON` por env var (override de operador).
 *  3. `python/.venv/bin/python` dentro del **store** de pnpm (caso
 *     npm-puro o paquete auto-consumido).
 *  4. `python/.venv/bin/python` dentro de la **fuente** original
 *     (caso pnpm con `file:` — el store es copia sin `.venv`).
 *  5. `python/.venv/bin/python` calculado desde `__filename` (legacy;
 *     solo aplica al paquete auto-consumido).
 *  6. `python3` del PATH como último recurso.
 */
export function pythonPath(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.SABER_PYTHON) return process.env.SABER_PYTHON;

  const storeRoot = resolvePackageRoot();
  if (storeRoot) {
    const venv = join(storeRoot, "python", ".venv", "bin", "python");
    if (existsSync(venv)) return venv;
  }

  const sourceRoot = resolveSourceRoot();
  if (sourceRoot) {
    const venv = join(sourceRoot, "python", ".venv", "bin", "python");
    if (existsSync(venv)) return venv;
  }

  // Fallback de legado: junto a __filename. Solo aplica al paquete
  // auto-consumido o self-published, ya casi nunca en uso.
  const venv = join(packageRoot(), "python", ".venv", "bin", "python");
  return existsSync(venv) ? venv : "python3";
}

function scriptPath(): string {
  // 1) Raíz REAL del paquete (incluye el caso pnpm, donde __filename está
  //    fuera de la carpeta del paquete y `packageRoot()` falla).
  const realRoot = resolvePackageRoot();
  if (realRoot) return join(realRoot, "python", "detect_layout.py");

  // 2) Fallback de legado: junto a __filename. Solo aplica al paquete
  //    auto-consumido o self-published, ya casi nunca en uso.
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
