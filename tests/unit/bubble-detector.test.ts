import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { detectBubbles } from "@/modules/scanning/infrastructure/bubble-detector";

/** Dibuja N círculos huecos (solo borde) en una imagen blanca. Simula la
 *  apariencia que tiene una hoja de respuestas después de binarizar.
 *  Usamos stroke 3 px para sobrevivir el downsample 1/3 (un stroke de 1 px
 *  se reduce a <1 px y desaparece con sharp). */
async function drawHollowCircles(
  circles: { cx: number; cy: number; r: number }[],
  width: number,
  height: number,
): Promise<Buffer> {
  const svgParts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    `<rect width="${width}" height="${height}" fill="white"/>`,
  ];
  for (const c of circles) {
    svgParts.push(
      `<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}" fill="none" stroke="black" stroke-width="3"/>`,
    );
  }
  svgParts.push("</svg>");
  return sharp(Buffer.from(svgParts.join("")))
    .png()
    .toBuffer();
}

describe("bubble-detector", () => {
  it("detects a single 8x8 grid of hollow circles", async () => {
    // 8 cols × 4 rows = 32 bubbles a 40 px de spacing. r=14 + stroke 3px
    // simula el diámetro 5.5mm @ 200 DPI (≈43 px) — un poco más chico
    // para evitar solapamiento tras downsample 1/3.
    const circles: { cx: number; cy: number; r: number }[] = [];
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 8; col++) {
        circles.push({ cx: 100 + col * 40, cy: 100 + row * 40, r: 14 });
      }
    }
    const img = await drawHollowCircles(circles, 500, 300);
    const result = await detectBubbles(img);
    expect(result.bubbles.length).toBeGreaterThanOrEqual(28);
    // Confianza > 0 — algo detectamos.
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("returns empty + zero confidence on a blank white image", async () => {
    const img = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .toBuffer();
    const result = await detectBubbles(img);
    expect(result.bubbles.length).toBe(0);
    expect(result.confidence).toBe(0);
  });

  it("rejects long thin lines (text/lines) via aspect ratio filter", async () => {
    // Una línea horizontal larga (200×3) sobre fondo blanco: aspect ~67,
    // debe ser rechazada por el filtro de aspect ratio y/o por dimensiones.
    const linePng = await sharp({
      create: { width: 200, height: 3, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    const img = await sharp({
      create: { width: 300, height: 100, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .composite([{ input: linePng, top: 50, left: 50 }])
      .png()
      .toBuffer();
    const result = await detectBubbles(img);
    // La línea debería ser rechazada (aspect ratio fuera de rango o
    // dimensiones mayores a MAX_DIAM_DS tras downsample).
    expect(result.bubbles.length).toBe(0);
  });

  it("detects dense black blobs (filled bubbles) and rejects sparse ones", async () => {
    // Un blob denso 20x20 (densidad alta) + un blob disperso de "texto" simulado.
    const denseBlob = await sharp({
      create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    // "Texto" simulado: 5 pixels sueltos en un bbox 40x40.
    const sparsePixels = await sharp({
      create: { width: 40, height: 40, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let i = 0; i < sparsePixels.data.length; i += 4) sparsePixels.data[i] = 255;
    // 5 píxeles negros
    [0, 100, 200, 300, 500].forEach((p) => {
      sparsePixels.data[p] = 0;
      sparsePixels.data[p + 1] = 0;
      sparsePixels.data[p + 2] = 0;
    });
    const sparseBlob = await sharp(sparsePixels.data, {
      raw: { width: 40, height: 40, channels: 3 },
    })
      .png()
      .toBuffer();

    const img = await sharp({
      create: { width: 300, height: 200, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .composite([
        { input: denseBlob, top: 50, left: 50 },
        { input: sparseBlob, top: 50, left: 150 },
      ])
      .png()
      .toBuffer();

    const result = await detectBubbles(img);
    // Solo el denso debe sobrevivir.
    expect(result.bubbles.length).toBe(1);
    expect(result.bubbles[0]!.cx).toBeGreaterThan(40);
    expect(result.bubbles[0]!.cx).toBeLessThan(100);
  });
});
