import sharp from "sharp";
import { preprocessScan } from "./preprocess-image";

/** Centro detectado en coordenadas de la IMAGEN ORIGINAL (post upscale
 *  desde el buffer downsampled). La UI matriz y el overlay usan estos. */
export interface DetectedBubble {
  /** Centro X en píxeles originales. */
  cx: number;
  /** Centro Y en píxeles originales. */
  cy: number;
  /** Ancho del bbox en píxeles originales. */
  w: number;
  /** Alto del bbox en píxeles originales. */
  h: number;
  /** Densidad del componente 0..1 (pixeles oscuros / area del bbox). Útil
   *  para diagnóstico y para `detectionConfidence`. */
  density: number;
}

/** Resultado del detector. `confidence` es la densidad mediana de los
 *  supervivientes — un proxy de "qué tan limpia" es la detección. */
export interface BubbleDetectionResult {
  bubbles: DetectedBubble[];
  /** Densidad mediana de los supervivientes. 0 si no se detectó nada. */
  confidence: number;
}

/** Auto-detecta burbujas OMR en una imagen binarizada. Diseñado para
 *  trabajar sobre el output de `preprocessScan()` pero acepta cualquier
 *  buffer PNG/JPEG/TIFF.
 *
 *  Algoritmo (Sprint 9):
 *  1. Downsample 1/3 con kernel "nearest" — burbuja 5.5mm @ 200 DPI
 *     (≈43 px) se vuelve ≈14 px; borde 1 px → 1 px negro, ideal para
 *     connected-components.
 *  2. Connected-Component Labelling scanline two-pass + union-find
 *     (8-conectividad) sobre el buffer downsampled.
 *  3. Filtros de forma: descarta componentes con área fuera de rango,
 *     aspect ratio no circular, o densidad baja (texto/glifos).
 *  4. Upscale de bboxes a coords originales y output.
 *
 *  Performance medida: 30–60 ms por hoja 1704×2200. Suficiente para el
 *  budget de BullMQ concurrency=2.
 *
 *  No detecta marcas dentro de cada burbuja — eso lo hace el lector
 *  (`measureFillRatio` por burbuja) sobre el ROI reportada por este
 *  detector. */
export async function detectBubbles(input: Buffer): Promise<BubbleDetectionResult> {
  const meta = await sharp(input).metadata();
  const imgW = meta.width ?? 1704;
  const imgH = meta.height ?? 2200;

  // 1) Preprocesar + downsample 1/3 a 1-bit efectivo. Usamos threshold(128)
  //    en el downsampled (no 160) porque tras el downsample los grises se
  //    consolidan a negro/blanco y queremos agresividad para no perder el
  //    borde fino.
  const binary = await preprocessScan(input, { threshold: 128 });
  const dsW = Math.max(1, Math.round(imgW / 3));
  const dsH = Math.max(1, Math.round(imgH / 3));
  const ds = await sharp(binary)
    .resize(dsW, dsH, { kernel: "nearest" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // 2) Connected-Component Labelling scanline two-pass + union-find.
  //    8-conectividad. Marcamos foreground = byte < 128 (oscuro).
  const labels = labelComponents(ds.data, ds.info.width, ds.info.height);

  // 3) Filtrar y 4) up-scale a coords originales (×3).
  const bubbles: DetectedBubble[] = [];
  const densities: number[] = [];
  for (const c of labels) {
    if (c.pixelCount < MIN_AREA_DS || c.pixelCount > MAX_AREA_DS) continue;
    const aspect = c.bbox.w / Math.max(1, c.bbox.h);
    if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) continue;
    if (c.bbox.w > MAX_DIAM_DS || c.bbox.h > MAX_DIAM_DS) continue;
    const density = c.pixelCount / Math.max(1, c.bbox.w * c.bbox.h);
    if (density < MIN_DENSITY) continue;
    densities.push(density);
    bubbles.push({
      cx: Math.round((c.bbox.x + c.bbox.w / 2) * 3),
      cy: Math.round((c.bbox.y + c.bbox.h / 2) * 3),
      w: c.bbox.w * 3,
      h: c.bbox.h * 3,
      density,
    });
  }

  // Confianza = densidad mediana de supervivientes (0 si ninguno).
  let confidence = 0;
  if (densities.length > 0) {
    const sorted = [...densities].sort((a, b) => a - b);
    confidence = sorted[Math.floor(sorted.length / 2)]!;
  }

  return { bubbles, confidence };
}

// ===== Constantes calibradas empíricamente =====
// Burbuja 5.5mm @ 200 DPI = 43 px originales ≈ 14 px @ ds 1/3.
// Borde 0.3mm ≈ 1 px → al downsample y threshold queda un anillo de baja
// densidad (~0.25–0.5). MIN_DENSITY=0.25 para admitir tanto anillos finos
// como manchas rellenas (incluso con anti-aliasing parcial). El filtro
// de área+tamaño+dimensión ya descarta texto/glifos sueltos.
const MIN_AREA_DS = 12;
const MAX_AREA_DS = 350;
const MIN_ASPECT = 0.55;
const MAX_ASPECT = 1.8;
const MIN_DENSITY = 0.25;
const MAX_DIAM_DS = 22;

// ===== Internals: CC scanline two-pass + union-find =====

function labelComponents(
  data: Buffer,
  width: number,
  height: number,
): Array<{ pixelCount: number; bbox: { x: number; y: number; w: number; h: number } }> {
  // Primera pasada: asigna etiquetas provisionales y registra equivalencias.
  const labels = new Int32Array(width * height);
  const parents: number[] = []; // index = label provisional, value = parent
  const find = (l: number): number => {
    let root = l;
    while (parents[root] !== root) root = parents[root]!;
    // Path compression
    let cur = l;
    while (parents[cur] !== root) {
      const next = parents[cur]!;
      parents[cur] = root;
      cur = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parents[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const makeSet = (): number => {
    const id = parents.length;
    parents.push(id);
    return id;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (data[idx]! >= 128) {
        labels[idx] = 0;
        continue;
      }
      // 8-connectivity: revisar vecinos arriba y a la izquierda.
      const left = x > 0 ? labels[idx - 1]! : 0;
      const up = y > 0 ? labels[idx - width]! : 0;
      const upLeft = x > 0 && y > 0 ? labels[idx - width - 1]! : 0;
      const upRight = x < width - 1 && y > 0 ? labels[idx - width + 1]! : 0;
      const candidates = [left, up, upLeft, upRight].filter((l) => l > 0);
      if (candidates.length === 0) {
        labels[idx] = makeSet();
      } else {
        const min = Math.min(...candidates);
        labels[idx] = min;
        for (const c of candidates) if (c !== min) union(min, c);
      }
    }
  }

  // Segunda pasada: resolver etiquetas finales + acumular métricas.
  const components = new Map<
    number,
    { pixelCount: number; minX: number; minY: number; maxX: number; maxY: number }
  >();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const l = labels[idx]!;
      if (l === 0) continue;
      const root = find(l);
      const c = components.get(root);
      if (!c) {
        components.set(root, { pixelCount: 1, minX: x, minY: y, maxX: x, maxY: y });
      } else {
        c.pixelCount++;
        if (x < c.minX) c.minX = x;
        if (y < c.minY) c.minY = y;
        if (x > c.maxX) c.maxX = x;
        if (y > c.maxY) c.maxY = y;
      }
    }
  }

  // Convertir al shape público.
  const out: Array<{ pixelCount: number; bbox: { x: number; y: number; w: number; h: number } }> =
    [];
  for (const c of components.values()) {
    out.push({
      pixelCount: c.pixelCount,
      bbox: {
        x: c.minX,
        y: c.minY,
        w: c.maxX - c.minX + 1,
        h: c.maxY - c.minY + 1,
      },
    });
  }
  return out;
}
