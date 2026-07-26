import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { BBox } from "./types";

const run = promisify(execFile);

/**
 * Resuelve la ruta absoluta de un binario externo (típicamente
 * `pdftoppm` para el render de páginas). Misma lógica que
 * `resolveBin` en `figures.ts` — ver docstring allí para el
 * rationale completo. En shells no-login `/opt/homebrew/bin`
 * no está en PATH aunque los binarios estén ahí.
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

/**
 * Ajuste determinista del bbox de una figura.
 *
 * El bbox que estima el modelo contiene la figura pero suele arrastrar texto
 * alrededor, y pedirle más precisión no funciona (deriva y a veces corta la
 * figura). Aquí se usa ese bbox solo como SEMILLA y se aprieta analizando los
 * píxeles de la página ya renderizada: la figura es tinta conectada, el texto
 * de alrededor son bandas finas y anchas que se pueden descartar.
 *
 * Regla de oro: solo ENCOGE, nunca crece, y ante cualquier duda devuelve null
 * para que se conserve el recorte original. Nunca debe empeorar lo que había.
 */

export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/* ------------------------------------------------------------------ */
/*  Render y lectura de PGM                                            */
/* ------------------------------------------------------------------ */

/** Renderiza una página a escala de grises y la devuelve como matriz. */
export async function renderPageGray(
  pdfPath: string,
  page: number,
  dpi: number,
  tmpDir: string,
): Promise<GrayImage> {
  const prefix = join(tmpDir, `.gray-${page}`);
  await run(resolveBin("pdftoppm"), [
    "-gray",
    "-r",
    String(dpi),
    "-f",
    String(page),
    "-l",
    String(page),
    pdfPath,
    prefix,
  ]);
  const produced = (await readdir(tmpDir)).filter((f) => f.startsWith(`.gray-${page}-`));
  const first = produced[0];
  if (first === undefined) throw new Error(`no se pudo renderizar la página ${page}`);
  const buf = await readFile(join(tmpDir, first));
  await Promise.all(produced.map((f) => rm(join(tmpDir, f), { force: true })));
  return parsePgm(buf);
}

/** Parsea un PGM binario (P5), tolerando comentarios en la cabecera. */
export function parsePgm(buf: Buffer): GrayImage {
  if (buf[0] !== 0x50 || buf[1] !== 0x35) throw new Error("no es un PGM P5");
  let p = 2;
  const fields: number[] = [];
  while (fields.length < 3) {
    while (p < buf.length && isSpace(buf[p]!)) p++;
    if (buf[p] === 0x23) {
      while (p < buf.length && buf[p] !== 0x0a) p++;
      continue;
    }
    let s = "";
    while (p < buf.length && !isSpace(buf[p]!)) s += String.fromCharCode(buf[p++]!);
    fields.push(Number(s));
  }
  p++; // un único separador tras maxval
  const [width, height] = fields as [number, number, number];
  return { width, height, data: new Uint8Array(buf.buffer, buf.byteOffset + p, width * height) };
}

function isSpace(b: number): boolean {
  return b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d;
}

/* ------------------------------------------------------------------ */
/*  Ajuste del bbox                                                    */
/* ------------------------------------------------------------------ */

export interface SnapOptions {
  /** Lado de la celda de análisis, en píxeles (def. 4). */
  cell?: number;
  /**
   * Alto máximo, en píxeles, para considerar que un componente ancho es una
   * línea de texto y no una figura (def. 46, calibrado a 150 dpi).
   */
  textLineHeight?: number;
  /** Margen que se deja alrededor del resultado, en fracción de página (def. 0.006). */
  pad?: number;
  /**
   * Si el resultado conserva menos que esta fracción del área de la semilla,
   * se descarta por sospechoso (def. 0.12).
   */
  minAreaRatio?: number;
}

export interface SnapResult {
  bbox: BBox;
  /** Fracción del área de la semilla que sobrevivió. */
  shrink: number;
}

/**
 * Aprieta `seed` alrededor de la figura que contiene. Devuelve null si no se
 * puede determinar con confianza, en cuyo caso hay que conservar `seed`.
 */
export function snapBBox(img: GrayImage, seed: BBox, opts: SnapOptions = {}): SnapResult | null {
  const { cell = 4, textLineHeight = 46, pad = 0.006, minAreaRatio = 0.12 } = opts;
  const { width: W, height: H, data } = img;

  const x0 = Math.max(0, Math.floor(seed[0] * W));
  const y0 = Math.max(0, Math.floor(seed[1] * H));
  const x1 = Math.min(W, Math.ceil(seed[2] * W));
  const y1 = Math.min(H, Math.ceil(seed[3] * H));
  const winW = x1 - x0;
  const winH = y1 - y0;
  if (winW < cell * 4 || winH < cell * 4) return null;

  const threshold = inkThreshold(data, W, x0, y0, x1, y1);

  // Rejilla de celdas con su fracción de tinta.
  const cols = Math.floor(winW / cell);
  const rows = Math.floor(winH / cell);
  if (cols < 4 || rows < 4) return null;
  const density = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let ink = 0;
      const py0 = y0 + r * cell;
      const px0 = x0 + c * cell;
      for (let dy = 0; dy < cell; dy++) {
        const rowOff = (py0 + dy) * W;
        for (let dx = 0; dx < cell; dx++) {
          if (data[rowOff + px0 + dx]! < threshold) ink++;
        }
      }
      density[r * cols + c] = ink / (cell * cell);
    }
  }

  // Celdas con algo de tinta, cerradas SOLO en horizontal: así las letras se
  // unen en palabras y renglones, pero los renglones NO se pegan entre sí y
  // siguen siendo componentes finos que se pueden descartar como texto.
  const on = new Uint8Array(cols * rows);
  for (let i = 0; i < density.length; i++) if (density[i]! > 0.02) on[i] = 1;
  // Los marcos y filetes atraviesan la ventana entera y tocan la figura: si no
  // se borran antes, la figura y el recuadro quedan en un mismo componente que
  // ocupa todo y no hay nada que apretar.
  removeRules(on, cols, rows);
  closeHorizontal(on, cols, rows, 2);

  const comps = components(on, cols, rows);
  if (comps.length === 0) return null;

  const seedArea = winW * winH;
  const sized = comps.filter((k) => k.cells * cell * cell > seedArea * 0.002);
  const isTextLine = (k: Component) => {
    const h = (k.r1 - k.r0 + 1) * cell;
    const w = (k.c1 - k.c0 + 1) * cell;
    return h <= textLineHeight && w > h * 2;
  };
  const kept = sized.filter((k) => {
    const h = (k.r1 - k.r0 + 1) * cell;
    const w = (k.c1 - k.c0 + 1) * cell;
    if (h < cell * 4) return false; // rayas sueltas
    if (isTextLine(k)) return false; // renglón de texto
    if (w * h > seedArea * 0.5 && k.fill < 0.12) return false; // marco residual
    return true;
  });
  if (kept.length === 0) return null;

  // El componente con más masa de tinta manda; se le suman los que estén
  // pegados (ejes, leyendas y partes sueltas de la misma figura).
  kept.sort((a, b) => b.mass - a.mass);
  const main = kept[0]!;
  let { r0, c0, r1, c1 } = main;
  const nearCells = Math.ceil((0.02 * H) / cell);
  let grew = true;
  while (grew) {
    grew = false;
    for (const k of kept) {
      if (k.c0 > c1 + nearCells || k.c1 < c0 - nearCells) continue;
      if (k.r0 > r1 + nearCells || k.r1 < r0 - nearCells) continue;
      const nr0 = Math.min(r0, k.r0),
        nc0 = Math.min(c0, k.c0);
      const nr1 = Math.max(r1, k.r1),
        nc1 = Math.max(c1, k.c1);
      if (nr0 !== r0 || nc0 !== c0 || nr1 !== r1 || nc1 !== c1) {
        r0 = nr0;
        c0 = nc0;
        r1 = nr1;
        c1 = nc1;
        grew = true;
      }
    }
  }

  // Los rótulos de eje y los títulos SÍ son renglones de texto, pero pertenecen
  // a la figura. Se recuperan solo si están pegados por arriba o por abajo y no
  // se salen por los lados: el texto del enunciado queda AL LADO, y así no se
  // cuela. La comparación es siempre contra los límites ORIGINALES: si se
  // usaran los que van creciendo, un párrafo se encadenaría renglón a renglón.
  const labelGap = Math.ceil((0.012 * H) / cell);
  const fixR0 = r0,
    fixR1 = r1;
  for (const k of sized) {
    if (!isTextLine(k)) continue;
    if (k.c0 < c0 - labelGap || k.c1 > c1 + labelGap) continue;
    const above = k.r1 < fixR0 && k.r1 >= fixR0 - labelGap;
    const below = k.r0 > fixR1 && k.r0 <= fixR1 + labelGap;
    if (!above && !below) continue;
    r0 = Math.min(r0, k.r0);
    r1 = Math.max(r1, k.r1);
  }

  const bx0 = (x0 + c0 * cell) / W - pad;
  const by0 = (y0 + r0 * cell) / H - pad;
  const bx1 = (x0 + (c1 + 1) * cell) / W + pad;
  const by1 = (y0 + (r1 + 1) * cell) / H + pad;

  // Nunca crecer más allá de la semilla, y desconfiar de un recorte minúsculo.
  const out: BBox = [
    Math.max(seed[0], bx0),
    Math.max(seed[1], by0),
    Math.min(seed[2], bx1),
    Math.min(seed[3], by1),
  ];
  const area = (out[2] - out[0]) * (out[3] - out[1]);
  const seedNorm = (seed[2] - seed[0]) * (seed[3] - seed[1]);
  if (area <= 0 || seedNorm <= 0) return null;
  const shrink = area / seedNorm;
  if (shrink < minAreaRatio) return null;

  return { bbox: out, shrink };
}

/**
 * Umbral de tinta. El papel del escaneo ronda 255 y las marcas de agua 250, así
 * que se toma el brillo del fondo y se baja un margen: así la marca de agua
 * nunca cuenta como tinta.
 */
function inkThreshold(
  data: Uint8Array,
  W: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const hist = new Uint32Array(256);
  let n = 0;
  for (let y = y0; y < y1; y += 2) {
    const off = y * W;
    for (let x = x0; x < x1; x += 2) {
      hist[data[off + x]!]!++;
      n++;
    }
  }
  // Percentil 90: el papel domina la parte alta del histograma.
  let acc = 0;
  let bg = 255;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v]!;
    if (acc >= n * 0.1) {
      bg = v;
      break;
    }
  }
  return Math.min(220, Math.max(120, bg - 55));
}

/**
 * Borra filetes: filas o columnas de celdas casi llenas de punta a punta cuyos
 * vecinos están casi vacíos. Son los bordes de recuadros, las separadoras y las
 * líneas de tabla; si se dejan, conectan la figura con todo lo demás.
 */
function removeRules(on: Uint8Array, cols: number, rows: number): void {
  const rowSum = new Int32Array(rows);
  const colSum = new Int32Array(cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (on[r * cols + c]) {
        rowSum[r]!++;
        colSum[c]!++;
      }
    }
  }
  for (let r = 0; r < rows; r++) {
    if (rowSum[r]! < cols * 0.85) continue;
    const above = r > 0 ? rowSum[r - 1]! : 0;
    const below = r < rows - 1 ? rowSum[r + 1]! : 0;
    if (above > cols * 0.4 && below > cols * 0.4) continue; // bloque, no filete
    for (let c = 0; c < cols; c++) on[r * cols + c] = 0;
  }
  for (let c = 0; c < cols; c++) {
    if (colSum[c]! < rows * 0.85) continue;
    const left = c > 0 ? colSum[c - 1]! : 0;
    const right = c < cols - 1 ? colSum[c + 1]! : 0;
    if (left > rows * 0.4 && right > rows * 0.4) continue;
    for (let r = 0; r < rows; r++) on[r * cols + c] = 0;
  }
}

/** Dilata y erosiona en horizontal: une caracteres sin pegar renglones. */
function closeHorizontal(on: Uint8Array, cols: number, rows: number, k: number): void {
  const tmp = new Uint8Array(on.length);
  for (let r = 0; r < rows; r++) {
    const base = r * cols;
    for (let c = 0; c < cols; c++) {
      let v = 0;
      for (let d = -k; d <= k && !v; d++) {
        const cc = c + d;
        if (cc >= 0 && cc < cols && on[base + cc]) v = 1;
      }
      tmp[base + c] = v;
    }
  }
  for (let r = 0; r < rows; r++) {
    const base = r * cols;
    for (let c = 0; c < cols; c++) {
      let v = 1;
      for (let d = -k; d <= k && v; d++) {
        const cc = c + d;
        if (cc >= 0 && cc < cols && !tmp[base + cc]) v = 0;
      }
      on[base + c] = v;
    }
  }
}

interface Component {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
  cells: number;
  mass: number;
  /** Celdas encendidas sobre el área de su bbox: distingue un marco de un bloque. */
  fill: number;
}

/** Componentes conexos (8-vecindad) sobre la rejilla de celdas. */
function components(on: Uint8Array, cols: number, rows: number): Component[] {
  const seen = new Uint8Array(on.length);
  const out: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < on.length; start++) {
    if (!on[start] || seen[start]) continue;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    let r0 = rows,
      c0 = cols,
      r1 = 0,
      c1 = 0,
      cells = 0;
    while (stack.length) {
      const i = stack.pop()!;
      const r = (i / cols) | 0;
      const c = i % cols;
      cells++;
      if (r < r0) r0 = r;
      if (r > r1) r1 = r;
      if (c < c0) c0 = c;
      if (c > c1) c1 = c;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr,
            cc = c + dc;
          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
          const j = rr * cols + cc;
          if (on[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    const boxCells = (r1 - r0 + 1) * (c1 - c0 + 1);
    out.push({ r0, c0, r1, c1, cells, mass: cells, fill: cells / boxCells });
  }
  return out;
}
