import sharp from "sharp";
import type { SheetTemplate } from "@/modules/printing/domain/sheet-template";
import { type Affine, applyAffine, affineScale } from "../domain/registration";

/** Lectura de una burbuja concreta de la plantilla sobre el escaneo. */
export interface SampledBubble {
  question: number;
  key: string;
  /** Proporción de píxeles oscuros dentro del disco interior, 0..1. */
  fillRatio: number;
  /** Centro muestreado en píxeles del escaneo (para overlay y diagnóstico). */
  cx: number;
  cy: number;
  /** Radio del disco interior muestreado, en píxeles. */
  radius: number;
  /** `true` si el disco se salió de la imagen (lectura no fiable). */
  outOfBounds: boolean;
}

export interface SampleOptions {
  /**
   * Fracción del radio de la burbuja que se muestrea, medida desde el centro.
   *
   * La burbuja impresa es un anillo (borde 0.3 mm) con la letra de la opción
   * dentro. Si se muestreara el rectángulo completo, el borde aportaría
   * píxeles oscuros a TODAS las burbujas y aplanaría la diferencia entre
   * marcada y vacía. Muestreando el disco interior el anillo queda fuera;
   * la letra sigue dentro y es lo que fija el piso de una burbuja vacía.
   */
  innerRadiusFactor?: number;
  /** Umbral de "oscuro" sobre la imagen en escala de grises (0-255). */
  darkThreshold?: number;
}

const DEFAULTS = { innerRadiusFactor: 0.72, darkThreshold: 128 } as const;

/**
 * Mide el relleno de cada burbuja de la plantilla sobre la imagen escaneada,
 * usando la transformación de registro para saber dónde mirar.
 *
 * A diferencia de `measureFillRatio`, que hace un `sharp.extract` por región
 * (427 llamadas por hoja), aquí se decodifica la imagen UNA vez a un buffer
 * en escala de grises y el muestreo se hace en JS puro sobre ese buffer.
 */
export async function sampleTemplate(
  image: Buffer,
  template: SheetTemplate,
  transform: Affine,
  options: SampleOptions = {},
): Promise<SampledBubble[]> {
  const innerRadiusFactor = options.innerRadiusFactor ?? DEFAULTS.innerRadiusFactor;
  const darkThreshold = options.darkThreshold ?? DEFAULTS.darkThreshold;

  const { data, info } = await sharp(image)
    .grayscale()
    .normalise()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const scale = affineScale(transform);
  const out: SampledBubble[] = [];

  for (const bubble of template.bubbles) {
    const center = applyAffine(transform, {
      x: bubble.rect.x + bubble.rect.w / 2,
      y: bubble.rect.y + bubble.rect.h / 2,
    });
    // El rect es cuadrado salvo redondeos; se toma el semieje menor para que
    // el disco quepa aunque la transformación tenga escalas distintas por eje.
    const radius =
      Math.min(bubble.rect.w * scale.sx, bubble.rect.h * scale.sy) * 0.5 * innerRadiusFactor;

    const minX = Math.floor(center.x - radius);
    const maxX = Math.ceil(center.x + radius);
    const minY = Math.floor(center.y - radius);
    const maxY = Math.ceil(center.y + radius);
    const outOfBounds = minX < 0 || minY < 0 || maxX >= width || maxY >= height;

    let dark = 0;
    let total = 0;
    const r2 = radius * radius;
    for (let y = Math.max(0, minY); y <= Math.min(height - 1, maxY); y++) {
      const dy = y - center.y;
      for (let x = Math.max(0, minX); x <= Math.min(width - 1, maxX); x++) {
        const dx = x - center.x;
        if (dx * dx + dy * dy > r2) continue; // disco, no cuadrado
        total++;
        if (data[(y * width + x) * channels]! < darkThreshold) dark++;
      }
    }

    out.push({
      question: bubble.question,
      key: bubble.key,
      fillRatio: total === 0 ? 0 : dark / total,
      cx: center.x,
      cy: center.y,
      radius,
      outOfBounds,
    });
  }

  return out;
}
