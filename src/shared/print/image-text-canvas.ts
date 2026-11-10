/**
 * Lectura de los píxeles de una imagen ya cargada en el DOM para detectar si
 * tiene texto y de qué altura es la línea más pequeña.
 *
 * Es la parte "navegador" de la detección: la lógica está en
 * `image-text-detection.ts` (pura y testeable); aquí solo se saca la imagen
 * del DOM, se pasa a escala de grises y se calcula el fondo local.
 *
 * Solo funciona con imágenes del mismo origen (las del cuadernillo vienen
 * incrustadas como `data:` URI). Si el canvas queda "contaminado" por una
 * imagen externa, `getImageData` lanza y se devuelve `null`: la imagen se
 * deja como está, que es el comportamiento seguro.
 */

import { boxBlurGray, detectTextBandHeights } from "./image-text-detection";

/**
 * Ancho máximo (px) al que se analiza la imagen.
 *
 * Analizar a tamaño completo no aporta nada (el texto se ve igual) y sí
 * cuesta: el fondo local es O(píxeles). A 800 px el texto más pequeño que
 * se detecta son 6 px del archivo, que es justo el límite por debajo del
 * cual el texto no se puede salvar ni ampliándolo.
 */
const MAX_ANALYSIS_WIDTH = 800;

/** Convierte RGBA a escala de grises (luma ITU-R 601-2, la misma de PIL). */
function toGray(rgba: Uint8ClampedArray, pixelCount: number): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(pixelCount);
  for (let i = 0, p = 0; i < pixelCount; i++, p += 4) {
    gray[i] = ((rgba[p] ?? 0) * 299 + (rgba[p + 1] ?? 0) * 587 + (rgba[p + 2] ?? 0) * 114) / 1000;
  }
  return gray;
}

/**
 * Altura de la línea de texto más pequeña de la imagen, en px del archivo.
 *
 * @param img Imagen ya cargada (`naturalWidth`/`naturalHeight` disponibles).
 * @returns `null` si no hay texto detectable o si no se pueden leer los
 *   píxeles (imagen externa).
 */
export function detectImageTextHeightPx(img: HTMLImageElement): number | null {
  const naturalWidth = img.naturalWidth;
  const naturalHeight = img.naturalHeight;
  if (!naturalWidth || !naturalHeight) return null;

  const scale = Math.min(1, MAX_ANALYSIS_WIDTH / naturalWidth);
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  try {
    ctx.drawImage(img, 0, 0, width, height);
  } catch {
    return null;
  }

  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, width, height);
  } catch {
    // Canvas contaminado (imagen de otro dominio): no se puede leer.
    return null;
  }

  const gray = toGray(data.data, width * height);
  const radius = Math.max(3, Math.floor(Math.min(width, height) / 30));
  const background = boxBlurGray(gray, width, height, radius);
  const heights = detectTextBandHeights(gray, background, width, height);
  if (heights.length === 0) return null;

  // Las alturas salen en px del análisis; hay que volver a los px del
  // archivo (la imagen se pudo haber analizado escalada).
  return Math.min(...heights) / scale;
}
