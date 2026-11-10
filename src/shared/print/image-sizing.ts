/**
 * Cálculo del tamaño de impresión de las imágenes del cuadernillo.
 *
 * CONTEXTO
 *
 * El cuadernillo se imprime en carta (letter) con `@page { margin: 1.5cm 2cm }`
 * (ver `src/styles/print.css`), así que la caja imprimible es de
 * 175.9 × 249.4 mm. El ancho que el docente fija arrastrando la imagen en
 * el editor se guarda como PORCENTAJE (`width="N%"`, ver
 * `components/editor/extensions.ts`) porque en píxeles fijos el tamaño
 * cambiaría entre la pantalla del editor y la columna impresa.
 *
 * El navegador aplica ese atributo como "presentational hint" → la propiedad
 * CSS `width`. La imagen se dibuja SIEMPRE a N% del ancho del contenedor,
 * sin mirar cuántos píxeles tiene el archivo. Consecuencia: una imagen de
 * 150 px arrastrada al 100% de una columna de 85 mm se imprime a 21 DPI
 * (ilegible), mientras que en la pantalla estaba a 96 DPI. O sea: el papel
 * sale PEOR que la pantalla.
 *
 * LA CORRECCIÓN: un tope ABSOLUTO (`max-width: <n>px`), no relativo al
 * contenedor. Un tope relativo NO funciona cuando la imagen ya trae un
 * ancho puesto: el tamaño intrínseco se recalcula con ese ancho y el tope no
 * recorta nada (verificado en Chromium, el mismo motor del worker de PDF:
 * con `width="100%"`, `max-width: max-content` deja la imagen a 800 px
 * dentro de un contenedor de 800 px, es decir, sin recorte).
 *
 * El tope en px es independiente del layout: la misma imagen ocupa el mismo
 * ancho en una columna de 85 mm que en una de 175 mm. Por eso se mide en
 * píxeles CSS y no en milímetros: 1 CSS px = 1/96 de pulgada siempre, en
 * pantalla y en el papel.
 *
 * La PLANTA (doble carta) no re-muestrea el booklet: en
 * `shared/imposition/booklet-pdf.ts` la escala es
 * `min(halfW/srcW, halfH/srcH)` y la mitad del pliego es exactamente carta
 * (612 × 792 pt), o sea escala 1. El DPI calculado aquí es el que sale
 * impreso en el pliego.
 */

import { padToMultipleOf4 } from "../imposition/booklet";

/** Píxeles CSS por pulgada. Es la convención del navegador y del CSS. */
export const CSS_PX_PER_INCH = 96;

/** Milímetros por pulgada. */
export const MM_PER_INCH = 25.4;

/**
 * Ancho imprimible de la hoja, en mm.
 *
 * El `@page` de `src/styles/print.css` define `size: letter portrait` y
 * `margin: 1.5cm 2cm`: la carta son 215,9 mm de ancho y con 20 mm de margen
 * a cada lado quedan 175,9 mm de caja imprimible (medido en los PDF
 * generados: el texto arranca en x = 20,1 mm).
 *
 * Sirve para saber si un ancho pedido cabe en la hoja y para convertir los
 * píxeles de la vista previa (que se ve a escala de pantalla) a milímetros
 * de papel.
 */
export const PRINT_SHEET_WIDTH_MM = 215.9 - 2 * 20;

/**
 * DPI mínimo garantizado en la impresión.
 *
 * 96 = el tamaño natural de la imagen: el papel sale tan nítido como la
 * pantalla y nunca peor. Subirlo (150, 200…) reduce la imagen para ganar
 * nitidez a costa de ocupar menos espacio en la página; bajarlo de 96
 * significaría AMPLIAR la imagen, que siempre es perder calidad, así que el
 * tope nunca supera el tamaño natural.
 */
export const DEFAULT_IMAGE_MIN_DPI = 96;

/** Convierte píxeles CSS a milímetros (1 px = 1/96 de pulgada). */
export function pxToMm(px: number): number {
  return (px * MM_PER_INCH) / CSS_PX_PER_INCH;
}

/** Convierte milímetros a píxeles CSS. */
export function mmToPx(mm: number): number {
  return (mm * CSS_PX_PER_INCH) / MM_PER_INCH;
}

/**
 * Ancho máximo (en px CSS) con el que se puede imprimir una imagen de
 * `naturalWidthPx` sin bajar de `minDpi`.
 *
 * El resultado NUNCA supera el tamaño natural de la imagen: ampliar es
 * siempre perder calidad, así que por debajo de 96 DPI el tope se queda en
 * el tamaño natural.
 */
export function computePrintImageCapPx(
  naturalWidthPx: number,
  minDpi: number = DEFAULT_IMAGE_MIN_DPI,
): number {
  if (!Number.isFinite(naturalWidthPx) || naturalWidthPx <= 0) return 0;
  const dpi = Math.max(1, minDpi);
  const byDpi = (naturalWidthPx * CSS_PX_PER_INCH) / dpi;
  return Math.max(1, Math.min(naturalWidthPx, Math.floor(byDpi)));
}

/** DPI efectivo de una imagen impresa con `renderedWidthPx` de ancho. */
export function computeEffectiveDpi(naturalWidthPx: number, renderedWidthPx: number): number {
  if (!Number.isFinite(renderedWidthPx) || renderedWidthPx <= 0) return 0;
  if (!Number.isFinite(naturalWidthPx) || naturalWidthPx <= 0) return 0;
  return (naturalWidthPx / renderedWidthPx) * CSS_PX_PER_INCH;
}

export interface PrintImageMetricsInput {
  /** Ancho natural del archivo, en px. */
  naturalWidth: number;
  /** Alto natural del archivo, en px. */
  naturalHeight: number;
  /** Ancho que pidió el docente (el `N%` ya resuelto contra el contenedor). */
  requestedWidth: number;
  /** Tope absoluto calculado con `computePrintImageCapPx`. */
  capPx: number;
}

export interface PrintImageMetrics {
  /** Ancho pedido por el docente, en px y en mm. */
  requestedWidth: number;
  requestedWidthMm: number;
  /** DPI que habría tenido la imagen con ese ancho. */
  requestedDpi: number;
  /** Ancho final tras aplicar el tope, en px y en mm. */
  finalWidth: number;
  finalWidthMm: number;
  finalHeightMm: number;
  /** DPI efectivo de la impresión. */
  dpi: number;
  /** `true` cuando el tope recortó lo que el docente pidió. */
  clamped: boolean;
}

/**
 * Métricas de una imagen ya dimensionada en la impresión.
 *
 * El ancho final es el menor entre lo pedido, el tope de calidad y el
 * tamaño natural (este último nunca se amplía). El alto se deriva del
 * ancho para preservar la proporción de la imagen.
 */
export function computePrintImageMetrics(input: PrintImageMetricsInput): PrintImageMetrics {
  const { naturalWidth, naturalHeight, requestedWidth, capPx } = input;

  const finalWidth = Math.max(0, Math.min(requestedWidth, capPx, naturalWidth));
  const finalHeight = naturalWidth > 0 ? (finalWidth * naturalHeight) / naturalWidth : 0;

  return {
    requestedWidth,
    requestedWidthMm: pxToMm(requestedWidth),
    requestedDpi: computeEffectiveDpi(naturalWidth, requestedWidth),
    finalWidth,
    finalWidthMm: pxToMm(finalWidth),
    finalHeightMm: pxToMm(finalHeight),
    dpi: computeEffectiveDpi(naturalWidth, finalWidth),
    clamped: finalWidth < requestedWidth,
  };
}

export interface BookletPageBudget {
  /** Páginas lógicas con contenido. */
  contentPages: number;
  /** Páginas del cuadernillo (siempre múltiplo de 4). */
  paddedPages: number;
  /** Pliegos doble carta que hay que imprimir. */
  sheets: number;
  /** Páginas que quedan en blanco por el redondeo a múltiplo de 4. */
  blankPages: number;
}

/**
 * Presupuesto de papel de un cuadernillo.
 *
 * La imposición saddle-stitch reparte 4 páginas lógicas por pliego doble
 * carta (dos caras × dos mitades), así que el número de páginas tiene que
 * ser múltiplo de 4. Lo que sobra se pagina en blanco
 * (`padToMultipleOf4` en `shared/imposition/booklet.ts`).
 *
 * El costo NO es lineal: pasar de 12 a 13 páginas de contenido no cuesta
 * "un poco más de tinta", cuesta un pliego doble carta entero (3 páginas
 * en blanco). Por eso `blankPages` es el número que hay que vigilar cuando
 * se ajustan imágenes: es lo que se desperdicia en blanco.
 */
export function computeBookletPageBudget(contentPages: number): BookletPageBudget {
  const content = Math.max(0, Math.floor(contentPages));
  const padded = padToMultipleOf4(content);
  return {
    contentPages: content,
    paddedPages: padded,
    sheets: padded / 4,
    blankPages: padded - content,
  };
}
