import sharp from "sharp";

/**
 * Preprocesamiento de la imagen escaneada antes de la detección OMR:
 * escala de grises → normalización de contraste → umbral binario.
 * (REQUERIMIENTOS_v2.md §3.6 paso 1)
 */
export interface PreprocessOptions {
  /** Umbral de binarización 0-255 */
  threshold?: number;
}

export async function preprocessScan(
  input: Buffer,
  { threshold = 160 }: PreprocessOptions = {},
): Promise<Buffer> {
  return sharp(input).grayscale().normalise().threshold(threshold).png().toBuffer();
}

/**
 * Mide la proporción de píxeles oscuros (rellenos) dentro de una región circular.
 * Base del algoritmo heurístico de detección de burbujas.
 */
export async function measureFillRatio(
  binaryImage: Buffer,
  region: { left: number; top: number; width: number; height: number },
): Promise<number> {
  const { data, info } = await sharp(binaryImage)
    .extract(region)
    .raw()
    .toBuffer({ resolveWithObject: true });

  let dark = 0;
  const pixels = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i]! < 128) dark++;
  }
  return pixels === 0 ? 0 : dark / pixels;
}
