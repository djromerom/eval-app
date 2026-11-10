/**
 * Cálculo del tamaño con el que se imprime cada imagen del cuadernillo.
 *
 * Vive fuera del componente React para poder ejercitarlo en un navegador de
 * prueba (Puppeteer) con el MISMO código que corre en la impresión: la
 * lógica de dos columnas y de recorte al contenedor es justamente la que no
 * se puede verificar con una prueba unitaria.
 *
 * Lo que hace, por imagen:
 *
 * 1. Mide el ancho que el docente dejó (`width="N%"` ya resuelto) y lo
 *    convierte a milímetros de PAPEL (la vista previa se ve a escala de
 *    pantalla; el papel no).
 * 2. Calcula el tope de calidad (nunca ampliar más allá de los píxeles).
 * 3. Busca texto dentro de la imagen y, si lo hay, calcula el ancho mínimo
 *    con el que ese texto llega a `MIN_PRINT_TEXT_PT` (6 pt).
 * 4. Devuelve el plan: el tope siempre, y el ancho mínimo solo cuando hace
 *    falta (el resto de las imágenes se quedan como el docente las dejó).
 */

import {
  computePrintImageCapPx,
  computePrintImageMetrics,
  DEFAULT_IMAGE_MIN_DPI,
  PRINT_SHEET_WIDTH_MM,
  type PrintImageMetrics,
} from "./image-sizing";
import { detectImageTextHeightPx } from "./image-text-canvas";
import {
  MIN_PRINT_TEXT_PT,
  PT_PER_PX,
  resolveTextFloor,
  type TextFloorResult,
} from "./image-text-detection";

/**
 * Milímetros de papel por píxel de la vista actual.
 *
 * La vista previa dibuja la hoja a ~800 px de ancho y el PDF la imprime a
 * 175,9 mm: la proporción entre la hoja y su contenido NO es la misma en
 * los dos casos. Medir la hoja y convertir por esa proporción deja que la
 * comparación "el ancho actual vs. el ancho mínimo" se haga en milímetros
 * de papel en los dos casos.
 */
export function measureMmPerPx(img: HTMLElement): number {
  const sheet = img.closest<HTMLElement>(".sheet");
  const host = sheet ?? document.documentElement;
  const style = window.getComputedStyle(host);
  const contentPx =
    host.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
  if (!contentPx || contentPx <= 0) return 25.4 / 96;
  return PRINT_SHEET_WIDTH_MM / contentPx;
}

export interface PrintImagePlanInput {
  /** DPI mínimo garantizado en el papel. */
  minDpi?: number;
  /** Ancho imprimible de la hoja, en mm. */
  sheetWidthMm?: number;
  /**
   * Cache de la detección de texto por `src`. La misma imagen puede
   * repetirse en varias preguntas: analizarla una sola vez ahorra trabajo.
   */
  textHeightCache?: Map<string, number | null>;
}

export interface PrintImagePlan {
  /** Tope de calidad en px CSS (el `max-width` de la imagen). */
  capPx: number;
  /**
   * Ancho a fijar en la imagen, en mm. `null` = no fijar, se respeta el
   * ancho que puso el docente.
   */
  widthMm: number | null;
  /** Ancho actual medido, en mm de papel. */
  currentWidthMm: number;
  /** Ancho natural del archivo, en px. */
  naturalWidthPx: number;
  /** Alto de la línea de texto más pequeña, en px del archivo. */
  textHeightPx: number | null;
  /** Motivo del piso de legibilidad. */
  reason: TextFloorResult["reason"];
  /** Métricas de calidad (para el log de diagnóstico). */
  metrics: PrintImageMetrics;
}

/**
 * Calcula el plan de impresión de una imagen ya cargada.
 *
 * @returns `null` si la imagen no se puede dimensionar (rota, sin tamaño
 *   natural, o con reglas propias de la portada).
 */
export function planPrintImageSizing(
  img: HTMLImageElement,
  input: PrintImagePlanInput = {},
): PrintImagePlan | null {
  const { minDpi = DEFAULT_IMAGE_MIN_DPI, sheetWidthMm = PRINT_SHEET_WIDTH_MM } = input;

  const naturalWidth = img.naturalWidth;
  const naturalHeight = img.naturalHeight;
  // 0 = imagen rota o que no llegó a cargar.
  if (!naturalWidth || !naturalHeight) return null;

  // Ancho pedido por el docente (el `N%` ya resuelto contra el
  // contenedor). Se mide ANTES de aplicar el tope.
  const requestedWidth = img.getBoundingClientRect().width;
  if (!requestedWidth) return null;

  const capPx = computePrintImageCapPx(naturalWidth, minDpi);
  if (!capPx) return null;

  const metrics = computePrintImageMetrics({
    naturalWidth,
    naturalHeight,
    requestedWidth,
    capPx,
  });

  const mmPerPx = measureMmPerPx(img);
  const currentWidthMm = requestedWidth * mmPerPx;

  // El piso de legibilidad solo importa si la imagen se está imprimiendo
  // por debajo de su tamaño natural: por encima, el tope de arriba ya la
  // deja en su mejor resolución posible.
  let textHeightPx: number | null = null;
  if (requestedWidth < naturalWidth) {
    const src = img.getAttribute("src") ?? "";
    const cache = input.textHeightCache;
    let detected = cache?.get(src);
    if (detected === undefined) {
      detected = detectImageTextHeightPx(img);
      cache?.set(src, detected);
    }
    textHeightPx = detected;
  }

  const floor = resolveTextFloor({
    currentWidthMm,
    naturalWidthPx: naturalWidth,
    minTextHeightPx: textHeightPx,
    sheetWidthMm,
  });

  return {
    capPx,
    widthMm: floor.widthMm,
    currentWidthMm,
    naturalWidthPx: naturalWidth,
    textHeightPx,
    reason: floor.reason,
    metrics,
  };
}

/** Aplica al DOM el plan calculado por `planPrintImageSizing`. */
export function applyPrintImagePlan(img: HTMLImageElement, plan: PrintImagePlan): void {
  img.style.maxWidth = `min(${plan.capPx}px, 100%)`;
  if (plan.widthMm != null) {
    img.style.width = `${plan.widthMm.toFixed(2)}mm`;
    img.dataset.printFloorMm = plan.widthMm.toFixed(2);
  }
}

/** Descripción legible del plan, para el log de diagnóstico. */
export function describePrintImagePlan(plan: PrintImagePlan): string {
  const textPt = (plan.textHeightPx ?? 0) * PT_PER_PX;
  const mm = (n: number) => n.toFixed(1);
  return (
    `La imagen (${plan.naturalWidthPx} px) tiene un texto de ${mm(plan.textHeightPx ?? 0)} px ` +
    `(${mm(textPt)} pt a tamaño natural). Iba a imprimirse a ${mm(plan.currentWidthMm)} mm` +
    (plan.widthMm != null
      ? ` y se ajusta a ${mm(plan.widthMm)} mm para que el texto llegue a ${MIN_PRINT_TEXT_PT} pt.`
      : ` y se deja como está (${plan.reason}).`)
  );
}
