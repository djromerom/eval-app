/**
 * Detección de texto dentro de una imagen y cálculo del ancho mínimo con el
 * que esa imagen se puede imprimir sin que su texto se vuelva ilegible.
 *
 * POR QUÉ EXISTE
 *
 * El tope de calidad (`computePrintImageCapPx`) solo evita que una imagen
 * salga BORROSA: nunca amplía más allá de su tamaño natural. Pero el docente
 * puede dejar una imagen muy por debajo de ese tamaño (el `width="N%"` que
 * arrastra en el editor) y entonces el archivo no se ve borroso: se ve
 * PEQUEÑO. En una captura de pantalla con etiquetas de 10 px, impresa a
 * 35 mm, esas etiquetas quedan en 2,4 pt — ilegibles. El tamaño natural de
 * la imagen no arregla eso: el docente decidió el ancho y el papel lo respeta.
 *
 * Este módulo calcula el ancho MÍNIMO a partir de la altura real del texto
 * que hay dentro del archivo:
 *
 *   - el texto más pequeño mide `h` px en la imagen;
 *   - a tamaño natural (1 px de archivo = 1 px CSS = 0,75 pt) ese texto mide
 *     `h × 0,75` pt;
 *   - para que mida `MIN_PRINT_TEXT_PT` puntos, la imagen tiene que imprimirse
 *     a `natural × MIN_PT / (h × 0,75)`.
 *
 * Como ese factor se multiplica por el ancho natural, el resultado SIEMPRE
 * queda en el tamaño natural o por debajo: nunca se amplía una imagen más
 * allá de sus píxeles (eso sería peor que el problema que se quiere
 * resolver).
 *
 * LA DETECCIÓN
 *
 * Es una heurística de píxeles, no un OCR: se busca "filas que tienen forma de
 * línea de texto" (varios trazos verticales cortos, separados por huecos
 * pequeños, con cuerpo en toda la línea). Sirve para distinguir una captura
 * de pantalla o una tabla de una fotografía, que es la distinción que
 * importa: a una foto no se le agranda nada, a una captura con texto sí.
 *
 * Los umbrales están calibrados contra las 224 imágenes reales que hay en
 * los cuadernillos de producción (capturas, tablas, diagramas y fotos).
 */

import { pxToMm } from "./image-sizing";

/** Puntos por píxel CSS: 1 CSS px = 1/96 de pulgada = 0,75 pt. */
export const PT_PER_PX = 0.75;

/**
 * Altura mínima de texto (en puntos) que se considera legible en el papel.
 *
 * 6 pt es el umbral por debajo del cual un rótulo deja de leerse sin
 * esfuerzo: el cuerpo del examen se imprime a 10 pt (`print.css`) y las
 * notas al pie del cuadernillo a 8 pt. Un rótulo dentro de una captura no
 * puede llegar a 10 pt sin re-exportar la captura a más resolución, pero sí
 * puede llegar a 6 pt manteniendo la imagen dentro de su tamaño natural.
 */
export const MIN_PRINT_TEXT_PT = 6;

/** Contraste mínimo (0-255) entre la tinta y el fondo local. */
const INK_CONTRAST = 22;

/** Alto mínimo (px) de una banda para que se pueda considerar texto. */
const MIN_BAND_HEIGHT = 4;

/** Alto máximo (px) de una banda: por encima es un bloque, no una línea. */
const MAX_BAND_HEIGHT = 40;

/** Fracción del ancho que tiene que tener tinta para que una fila cuente. */
const MIN_ROW_INK_RATIO = 0.03;

/** El trazo típico mide al menos este porcentaje del alto de la línea. */
const MIN_STROKE_WIDTH_RATIO = 0.35;

/** ...y nunca más de este porcentaje del ancho de la imagen. */
const MAX_STROKE_WIDTH_RATIO = 0.25;

/** El hueco entre trazos no puede pasar de esta vez el ancho del trazo. */
const MAX_GAP_WIDTH_RATIO = 2.5;

/** Cobertura de tinta mínima (0-1) dentro de la banda. */
const MIN_BAND_COVERAGE = 0.05;

/** Cobertura de tinta máxima (0-1) dentro de la banda. */
const MAX_BAND_COVERAGE = 0.7;

/**
 * Fracción de las filas de la banda que tienen que "tener cuerpo".
 *
 * Una línea de texto enciende la mayoría de sus filas (la zona de altura de
 * x). Un patrón de líneas (ladrillos, marcos, ramas) solo enciende filas
 * sueltas: por eso un muro de ladrillos no debe pasar por texto.
 */
const MIN_BAND_SOLIDITY = 0.5;

/**
 * Fracción de columnas con trazo vertical continuo (las "astas" de las
 * letras). Deben ocupar una parte apreciable del ancho: una marca de agua
 * suelta o un marco no llenan la línea.
 */
const MIN_STEM_RATIO = 0.08;

/**
 * Estimación del fondo local por media de ventana (integral image).
 *
 * Es la diferencia con el fondo la que define la tinta: en una captura
 * clara el fondo es el color del panel y la tinta es el texto; en una foto
 * oscura el fondo es el cielo y la tinta es la silueta. Un umbral global no
 * sirve para los dos casos.
 *
 * @param gray Escala de grises de la imagen (un valor por píxel).
 * @param width Ancho en píxeles.
 * @param height Alto en píxeles.
 * @param radius Radio de la ventana en píxeles.
 */
export function boxBlurGray(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Float64Array {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  const out = new Float64Array(w * h);
  if (w === 0 || h === 0) return out;
  const r = Math.max(0, Math.floor(radius));

  // Integral image: integral[y][x] = suma de gray[0..y-1][0..x-1].
  const stride = w + 1;
  const integral = new Float64Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    const src = y * w;
    const dst = (y + 1) * stride;
    const prev = y * stride;
    for (let x = 0; x < w; x++) {
      rowSum += gray[src + x] ?? 0;
      integral[dst + x + 1] = (integral[prev + x + 1] ?? 0) + rowSum;
    }
  }

  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h - 1, y + r);
    const rows = y1 - y0 + 1;
    const top = y0 * stride;
    const bottom = (y1 + 1) * stride;
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      const area = rows * (x1 - x0 + 1);
      const sum =
        (integral[bottom + x1 + 1] ?? 0) -
        (integral[bottom + x0] ?? 0) -
        (integral[top + x1 + 1] ?? 0) +
        (integral[top + x0] ?? 0);
      out[y * w + x] = sum / area;
    }
  }
  return out;
}

/** Una banda horizontal de la imagen. */
interface Band {
  /** Fila inicial (inclusive). */
  top: number;
  /** Fila final (exclusive). */
  bottom: number;
}

/** Divide las filas con tinta en bandas contiguas. */
function findInkBands(rowInk: Int32Array, height: number, rowThreshold: number): Band[] {
  const bands: Band[] = [];
  let y = 0;
  while (y < height) {
    if ((rowInk[y] ?? 0) >= rowThreshold) {
      let bottom = y;
      while (bottom < height && (rowInk[bottom] ?? 0) >= rowThreshold) bottom++;
      bands.push({ top: y, bottom });
      y = bottom;
    } else {
      y++;
    }
  }
  return bands;
}

/**
 * Calcula las alturas (en px de la imagen analizada) de las bandas que
 * parecen líneas de texto.
 *
 * @param gray Escala de grises de la imagen.
 * @param background Fondo local estimado (`boxBlurGray`).
 * @param width Ancho en píxeles.
 * @param height Alto en píxeles.
 */
export function detectTextBandHeights(
  gray: Uint8ClampedArray,
  background: Float64Array,
  width: number,
  height: number,
): number[] {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  if (w === 0 || h === 0) return [];

  // Máscara de tinta: más oscura que su fondo local.
  const ink = new Uint8Array(w * h);
  const rowInk = new Int32Array(h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let count = 0;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      if ((background[i] ?? 0) - (gray[i] ?? 0) > INK_CONTRAST) {
        ink[i] = 1;
        count++;
      }
    }
    rowInk[y] = count;
  }

  const rowThreshold = Math.max(3, Math.floor(w * MIN_ROW_INK_RATIO));
  const bands = findInkBands(rowInk, h, rowThreshold);
  const heights: number[] = [];

  for (const band of bands) {
    const alt = band.bottom - band.top;
    if (alt < MIN_BAND_HEIGHT || alt > MAX_BAND_HEIGHT) continue;

    // Columnas con tinta dentro de la banda → "trazos".
    const colHasInk = new Uint8Array(w);
    let inkPixels = 0;
    for (let y = band.top; y < band.bottom; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (ink[row + x]) {
          colHasInk[x] = 1;
          inkPixels++;
        }
      }
    }

    //-separaciones entre trazos
    const strokeStarts: number[] = [];
    const strokeEnds: number[] = [];
    let x = 0;
    while (x < w) {
      if (colHasInk[x]) {
        const start = x;
        while (x < w && colHasInk[x]) x++;
        strokeStarts.push(start);
        strokeEnds.push(x - 1);
      } else {
        x++;
      }
    }
    if (strokeStarts.length < 4) continue;

    const strokeWidths: number[] = [];
    for (let i = 0; i < strokeStarts.length; i++) {
      strokeWidths.push((strokeEnds[i] ?? 0) - (strokeStarts[i] ?? 0) + 1);
    }
    const sortedWidths = [...strokeWidths].sort((a, b) => a - b);
    const medianWidth = sortedWidths[Math.floor(sortedWidths.length / 2)] ?? 0;

    // El trazo tiene que guardar proporción con el alto de la línea: una
    // letra es más alta que ancha; una rama o una junta no.
    if (medianWidth < MIN_STROKE_WIDTH_RATIO * alt) continue;
    if (medianWidth > MAX_STROKE_WIDTH_RATIO * w) continue;

    // Los huecos entre trazos tienen que ser pequeños: son los espacios
    // entre letras, no los huecos de un dibujo.
    if (strokeStarts.length >= 2) {
      const gaps: number[] = [];
      for (let i = 0; i < strokeStarts.length - 1; i++) {
        gaps.push((strokeStarts[i + 1] ?? 0) - (strokeEnds[i] ?? 0) - 1);
      }
      gaps.sort((a, b) => a - b);
      const medianGap = gaps[Math.floor(gaps.length / 2)] ?? 0;
      if (medianGap > MAX_GAP_WIDTH_RATIO * medianWidth) continue;
    }

    const coverage = inkPixels / (alt * w);
    if (coverage < MIN_BAND_COVERAGE || coverage > MAX_BAND_COVERAGE) continue;

    // Solidez: cuántas filas de la banda tienen tinta de verdad. Un patrón de
    // líneas (ladrillos, marcos) solo enciende filas sueltas.
    const rowSums = new Int32Array(alt);
    let maxRowSum = 0;
    for (let i = 0; i < alt; i++) {
      const row = (band.top + i) * w;
      let sum = 0;
      for (let x2 = 0; x2 < w; x2++) if (ink[row + x2]) sum++;
      rowSums[i] = sum;
      if (sum > maxRowSum) maxRowSum = sum;
    }
    if (maxRowSum <= 0) continue;
    let solidRows = 0;
    for (let i = 0; i < alt; i++) if ((rowSums[i] ?? 0) >= 0.35 * maxRowSum) solidRows++;
    if (solidRows / alt < MIN_BAND_SOLIDITY) continue;

    // Astas: columnas con trazo vertical continuo a lo largo de la línea.
    let stems = 0;
    for (let x2 = 0; x2 < w; x2++) {
      let covered = 0;
      for (let i = 0; i < alt; i++) {
        if (ink[(band.top + i) * w + x2]) covered++;
      }
      if (covered >= 0.45 * alt) stems++;
    }
    if (stems < MIN_STEM_RATIO * w) continue;

    heights.push(alt);
  }

  return heights;
}

export interface TextFloorInput {
  /** Ancho actual de la imagen en el papel, en mm. */
  currentWidthMm: number;
  /** Ancho natural del archivo, en px. */
  naturalWidthPx: number;
  /**
   * Alto de la línea de texto más pequeña dentro de la imagen, en px del
   * archivo. `null` cuando la imagen no tiene texto detectable.
   */
  minTextHeightPx: number | null;
  /** Ancho imprimible de la hoja, en mm. */
  sheetWidthMm: number;
  /** Tamaño mínimo del texto en el papel, en pt. */
  minTextPt?: number;
}

export interface TextFloorResult {
  /**
   * Ancho al que hay que fijar la imagen, en mm. `null` = dejar el ancho
   * como lo dejó el docente.
   */
  widthMm: number | null;
  /** Motivo, para el log de diagnóstico. */
  reason: "sin-texto" | "ilegible" | "fuera-de-hoja" | "ya-legible" | "ajustado";
}

/**
 * Decide el ancho mínimo con el que una imagen se puede imprimir sin que
 * su texto se vuelva ilegible.
 *
 * Reglas, en orden:
 *
 * 1. Sin texto detectable → no se toca nada (una foto no se agranda).
 * 2. El texto es tan pequeño que ni a tamaño natural llega al mínimo → no
 *    se toca nada: ningún tamaño lo arregla, habría que re-exportar la
 *    imagen con más resolución. Agrandarla sin más solo gastaría papel.
 * 3. El ancho necesario no cabe ni en la hoja completa → no se toca nada por
 *    el mismo motivo.
 * 4. El texto ya se imprime con tamaño suficiente → no se toca nada (el
 *    ancho del docente se respeta).
 * 5. En otro caso → el ancho mínimo calculado.
 */
export function resolveTextFloor(input: TextFloorInput): TextFloorResult {
  const { currentWidthMm, naturalWidthPx, minTextHeightPx, sheetWidthMm } = input;
  const minTextPt = input.minTextPt ?? MIN_PRINT_TEXT_PT;

  if (minTextHeightPx == null || minTextHeightPx <= 0) {
    return { widthMm: null, reason: "sin-texto" };
  }
  if (!Number.isFinite(naturalWidthPx) || naturalWidthPx <= 0) {
    return { widthMm: null, reason: "sin-texto" };
  }

  const naturalWidthMm = pxToMm(naturalWidthPx);
  // Altura del texto (pt) si la imagen se imprime a tamaño natural.
  const textPtAtNatural = minTextHeightPx * PT_PER_PX;
  if (textPtAtNatural <= 0) {
    return { widthMm: null, reason: "sin-texto" };
  }
  // El tamaño natural es el máximo posible sin ampliar los píxeles: si
  // siquiera ahí el texto llega al mínimo, re-escalar no lo arregla.
  if (textPtAtNatural < minTextPt) {
    return { widthMm: null, reason: "ilegible" };
  }

  const neededWidthMm = naturalWidthMm * (minTextPt / textPtAtNatural);
  // Nunca por encima del tamaño natural: ampliar más allá de los píxeles
  // del archivo no añade legibilidad, solo borrosidad.
  const floorMm = Math.min(naturalWidthMm, neededWidthMm);

  if (floorMm > sheetWidthMm) {
    return { widthMm: null, reason: "fuera-de-hoja" };
  }
  if (currentWidthMm >= floorMm) {
    return { widthMm: null, reason: "ya-legible" };
  }
  return { widthMm: floorMm, reason: "ajustado" };
}
