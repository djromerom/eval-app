import decodeQR from "qr/decode.js";
import sharp from "sharp";
import type { QrDecoder } from "../domain/answer-sheet";

/**
 * Decoder QR position-invariant.
 *
 * Por qué position-invariant: el alimentador del escáner introduce drift —
 * el mismo QR aparece en posiciones distintas entre escaneos (en pruebas
 * reales, mismo pliego escaneado dos veces dio y=220 vs y=460 para el QR).
 * Asumir top-left fijo hace que el decoder falle en 1 de cada N escaneos.
 *
 * Estrategia calibrada empíricamente con 2 escaneos reales del pliego de
 * AMAYA ARDILA (1704×2200, 200 DPI). Funciona para todos los casos donde
 * el QR cae dentro de los primeros 1200 px del alto y 800 px del ancho
 * (cubre los formatos institucionales actuales).
 *
 * Cada estrategia: extract del original en una posición, upscale a
 * 1200-2400 con Lanczos3. La primera que decodifique gana. La lista está
 * ordenada por costo (las más rápidas + más universales primero); las
 * más tardías son fallbacks.
 *
 * Si en el futuro se requiere QR en cualquier parte de la página (no
 * solo margen izquierdo alto), agregar posiciones en x>0.
 */

interface DecodeStrategy {
  label: string;
  transform(input: Buffer, imgW: number, imgH: number): Promise<Buffer> | Promise<Buffer>;
  /** Lleva un punto del espacio de la imagen transformada de vuelta al
   *  espacio de la imagen ORIGINAL. Necesario porque cada estrategia
   *  recorta y reescala antes de decodificar, así que los finder patterns
   *  que reporta la librería no están en coords del escaneo. */
  mapBack(p: { x: number; y: number }, tw: number, th: number): { x: number; y: number };
}

/** Genera una estrategia "extract region + resize to target".
 *  Cap cada lado por las dimensiones reales para no fallar en imágenes
 *  más chicas (ej. 1200×1500 vs carta 1704×2200). */
function makeExtractStrategy(
  label: string,
  extractLeft: number,
  extractTop: number,
  extractW: number,
  extractH: number,
  target: number,
  thresh = false,
): DecodeStrategy {
  return {
    label,
    transform: async (b, imgW, imgH) => {
      // `imgW/imgH` reserved for future per-image calibration override
      void imgW;
      void imgH;
      let p = sharp(b).extract({
        left: extractLeft,
        top: extractTop,
        width: extractW,
        height: extractH,
      });
      if (target !== extractW || target !== extractH) {
        p = p.resize(target, target, { kernel: "lanczos3" });
      }
      if (thresh) p = p.threshold(128);
      return p.png().toBuffer();
    },
    // Deshacer resize (target → extractW/H) y luego el extract (+ offset).
    mapBack: (p, tw, th) => ({
      x: extractLeft + (p.x / tw) * extractW,
      y: extractTop + (p.y / th) * extractH,
    }),
  };
}

/** `sharp.resize(t, t)` usa `fit: "cover"`: escala hasta cubrir y recorta
 *  centrado. Para volver al original hay que deshacer recorte y escala. */
function makeCoverStrategy(
  label: string,
  target: number,
  imgW: number,
  imgH: number,
  extra?: (p: sharp.Sharp) => sharp.Sharp,
): DecodeStrategy {
  const scale = Math.max(target / imgW, target / imgH);
  const offX = (imgW * scale - target) / 2;
  const offY = (imgH * scale - target) / 2;
  return {
    label,
    transform: (b) => {
      let p = sharp(b).resize(target, target, { kernel: "lanczos3" });
      if (extra) p = extra(p);
      return p.png().toBuffer();
    },
    mapBack: (p) => ({ x: (p.x + offX) / scale, y: (p.y + offY) / scale }),
  };
}

function buildStrategies(imgW: number, imgH: number): DecodeStrategy[] {
  return [
    // ===== Estrategias universales (cubren todos los casos vistos) =====
    // top-left 800x800 → 1200 es la receta que funcionó en OLD y NEW scan.
    makeExtractStrategy("tl-800→1200", 0, 0, 800, 800, 1200),
    makeExtractStrategy("tl-800→2400", 0, 0, 800, 800, 2400),
    // top-left 1200x1200 → 1800 (también universal).
    makeExtractStrategy("tl-1200→1800", 0, 0, 1200, 1200, 1800),
    // Variantes con binarización para scans con ruido/bajo contraste.
    makeExtractStrategy("tl-800→1200-thresh", 0, 0, 800, 800, 1200, true),

    // ===== Cobertura ampliada para drift vertical (QR puede estar
    // movido hacia abajo por alimentador del escáner) =====
    makeExtractStrategy("y200-800→1200", 0, 200, 800, 800, 1200),
    makeExtractStrategy("y400-800→1200", 0, 400, 800, 800, 1200),
    makeExtractStrategy("y400-1200→1800", 0, 400, 1200, 1200, 1800),

    // ===== Cobertura ampliada en X (QR más centrado) =====
    makeExtractStrategy("x400-800→1200", 400, 0, 800, 800, 1200),

    // ===== Fallback: full image upscale (cuando el QR es muy chico
    // relativo al scan) =====
    makeCoverStrategy("full→1704", 1704, imgW, imgH),
    makeCoverStrategy("full→2400", 2400, imgW, imgH),

    // ===== Binarizaciones de último recurso =====
    {
      label: "tl-800→1200-gray-thresh",
      transform: async (b) => {
        return sharp(b)
          .extract({ left: 0, top: 0, width: 800, height: 800 })
          .resize(1200, 1200, { kernel: "lanczos3" })
          .grayscale()
          .threshold(128)
          .png()
          .toBuffer();
      },
      mapBack: (p, tw, th) => ({ x: (p.x / tw) * 800, y: (p.y / th) * 800 }),
    },
  ];
}

/** Punto en píxeles de la imagen ORIGINAL. */
export interface QrPoint {
  x: number;
  y: number;
}

/** Resultado extendido: además del texto, dónde está el QR en la imagen.
 *  Los finder patterns son las tres escuadras de las esquinas; se usan
 *  para registrar la hoja contra la plantilla (ver
 *  `scanning/domain/registration.ts`). */
export interface QrDecodeDetail {
  text: string;
  /** Finder patterns + punto de alineación, en coords de la imagen
   *  ORIGINAL (ya des-transformados desde el espacio de la estrategia). */
  points: QrPoint[];
}

async function tryDecode(
  strategy: DecodeStrategy,
  original: Buffer,
  imgW: number,
  imgH: number,
): Promise<QrDecodeDetail | null> {
  let transformed: Buffer;
  try {
    transformed = await strategy.transform(original, imgW, imgH);
  } catch {
    return null;
  }
  const { data, info } = await sharp(transformed).raw().toBuffer({ resolveWithObject: true });

  // Los puntos llegan por callback en el espacio de la imagen TRANSFORMADA.
  // `strategy.mapBack` los devuelve a coords del original.
  let captured: QrPoint[] = [];
  try {
    const text = decodeQR(
      { width: info.width, height: info.height, data },
      {
        pointsOnDetect: (pts: { x: number; y: number }[]) => {
          captured = pts.map((p) => ({ x: p.x, y: p.y }));
        },
      },
    );
    if (!text) return null;
    const mapped = captured.map((p) => strategy.mapBack(p, info.width, info.height));
    return { text, points: mapped };
  } catch {
    return null;
  }
}

export const sharpQrDecoder: QrDecoder = {
  async decode(buffer: Buffer) {
    const detail = await decodeQrWithPoints(buffer);
    return detail ? { text: detail.text, points: detail.points } : null;
  },
};

/** Igual que `sharpQrDecoder.decode` pero además devuelve la posición del
 *  QR en la imagen. Lo usa el registro de la hoja; el flujo que solo
 *  necesita el payload sigue usando `sharpQrDecoder`. */
export async function decodeQrWithPoints(buffer: Buffer): Promise<QrDecodeDetail | null> {
  const meta = await sharp(buffer).metadata();
  const imgW = meta.width ?? 1704;
  const imgH = meta.height ?? 2200;
  const strategies = buildStrategies(imgW, imgH);

  for (const strategy of strategies) {
    const detail = await tryDecode(strategy, buffer, imgW, imgH);
    if (detail) return detail;
  }
  return null;
}
