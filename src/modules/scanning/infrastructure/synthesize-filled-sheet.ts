import sharp from "sharp";
import type { SheetTemplate } from "@/modules/printing/domain/sheet-template";

/** Respuesta a "marcar" en la hoja sintética. */
export interface SyntheticMark {
  question: number;
  key: string;
}

export interface SynthesizeOptions {
  /** Ancho en px de la imagen resultante (simula el DPI del escáner). */
  width?: number;
  /** Desplazamiento horizontal en px, para simular el arrastre del alimentador. */
  offsetX?: number;
  /** Desplazamiento vertical en px. */
  offsetY?: number;
  /** Rotación en grados, para simular una hoja entrada torcida. */
  rotationDeg?: number;
  /** Opacidad de la marca (1 = negro pleno; <1 simula lápiz flojo). */
  markOpacity?: number;
}

/**
 * Toma una captura limpia de la hoja (la misma que produce
 * `captureSheetGeometry`) y la convierte en un "escaneo" sintético con un
 * conjunto conocido de burbujas marcadas.
 *
 * Existe para poder verificar el pipeline OMR de punta a punta con ground
 * truth exacto, sin depender de imprimir y escanear a mano. Permite además
 * inyectar el tipo de degradación que mete un escáner real —desplazamiento,
 * rotación, marca floja— y comprobar que el registro la absorbe.
 *
 * NO se usa en producción: es infraestructura de prueba. Vive en `src/`
 * (y no en `tests/`) porque el script de diagnóstico manual también la usa.
 */
export async function synthesizeFilledSheet(
  cleanSheet: Buffer,
  template: SheetTemplate,
  marks: SyntheticMark[],
  options: SynthesizeOptions = {},
): Promise<Buffer> {
  const {
    width: targetWidth = 1704,
    offsetX = 0,
    offsetY = 0,
    rotationDeg = 0,
    markOpacity = 1,
  } = options;

  const base = sharp(cleanSheet);
  const meta = await base.metadata();
  const srcW = meta.width!;
  const srcH = meta.height!;
  const targetHeight = Math.round((srcH / srcW) * targetWidth);

  // Índice de las burbujas a marcar, para no recorrer la plantilla por marca.
  const wanted = new Set(marks.map((m) => `${m.question}:${m.key}`));

  const circles: string[] = [];
  for (const b of template.bubbles) {
    if (!wanted.has(`${b.question}:${b.key}`)) continue;
    const cx = (b.rect.x + b.rect.w / 2) * targetWidth;
    const cy = (b.rect.y + b.rect.h / 2) * targetHeight;
    // 0.80 del radio: una marca a mano cubre el interior sin comerse el borde.
    const r = (Math.min(b.rect.w * targetWidth, b.rect.h * targetHeight) / 2) * 0.8;
    circles.push(
      `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="black" fill-opacity="${markOpacity}"/>`,
    );
  }

  const overlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${targetWidth}" height="${targetHeight}">${circles.join("")}</svg>`,
  );

  let out = sharp(await base.resize(targetWidth, targetHeight).png().toBuffer()).composite([
    { input: overlay, top: 0, left: 0 },
  ]);

  if (rotationDeg !== 0) {
    // `background` blanco: al rotar aparecen esquinas nuevas y deben quedar
    // como papel, no como negro (que el detector leería como marca).
    out = sharp(await out.png().toBuffer()).rotate(rotationDeg, {
      background: { r: 255, g: 255, b: 255 },
    });
  }

  if (offsetX !== 0 || offsetY !== 0) {
    const buf = await out.png().toBuffer();
    const m = await sharp(buf).metadata();
    out = sharp({
      create: {
        width: m.width! + Math.abs(offsetX),
        height: m.height! + Math.abs(offsetY),
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    }).composite([{ input: buf, left: Math.max(0, offsetX), top: Math.max(0, offsetY) }]);
  }

  return out.png().toBuffer();
}
