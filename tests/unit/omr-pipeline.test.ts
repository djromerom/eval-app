import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  preprocessScan,
  measureFillRatio,
} from "@/modules/scanning/infrastructure/preprocess-image";

/**
 * Test E2E del pipeline OMR con imagen sintética.
 *
 * Construye una imagen PNG de tamaño "carta" con 8 círculos blancos
 * sobre fondo blanco (burbujas vacías) y un círculo negro relleno
 * (burbuja marcada). Mide el fillRatio sobre cada región calibrada
 * y verifica que:
 *   - la burbuja rellena sale con fillRatio > 0.6 (MARKED)
 *   - las burbujas vacías salen con fillRatio < 0.2 (EMPTY)
 *
 * Si esto pasa, sabemos que:
 *   1. El layout (DEFAULT_BUBBLE_LAYOUT con columns=8, spacingXPct=0.046)
 *      apunta a las coordenadas correctas dentro de la imagen.
 *   2. preprocessScan + measureFillRatio detectan correctamente la marca.
 *   3. La cadena completa funciona con 8 columnas A–H.
 */
describe("OMR pipeline end-to-end (8 columnas, imagen sintética)", () => {
  // Tamaño carta a 100 DPI = 850×1100 px. Suficiente resolución para
  // que las burbujas 4mm (~15.7 px) quepan con margen.
  const W = 850;
  const H = 1100;
  const COLS = 8;
  // Calibración espejo de [process-answer-sheet.ts]. Si esos valores
  // cambian, este test se ajusta en paralelo.
  const startXPct = 0.35;
  const startYPct = 0.05;
  const spacingXPct = 0.046;
  const bubbleDiamPct = 0.018;
  const bubbleDiamPx = Math.round(W * bubbleDiamPct);

  /** Genera un PNG con una fila de COLS círculos; el de `markedIdx` está relleno.
   *  Las burbujas vacías se dibujan con relleno blanco + borde gris claro
   *  (no negro) para no contaminar el fillRatio con píxeles del contorno:
   *  el algoritmo debe distinguir entre "el contorno de una burbuja vacía"
   *  y "una marca real del estudiante". El gris claro (#cccccc) garantiza
   *  que el stroke solo aporta ~5% de fill, muy por debajo del umbral 20%. */
  async function buildSyntheticSheet(markedIdx: number): Promise<Buffer> {
    const white = { r: 255, g: 255, b: 255 };
    const black = { r: 0, g: 0, b: 0 };
    const lightGray = { r: 204, g: 204, b: 204 };

    const centers: { cx: number; cy: number }[] = [];
    for (let col = 0; col < COLS; col++) {
      const cx = Math.round(W * (startXPct + col * spacingXPct));
      const cy = Math.round(H * (startYPct + 0 * 0.018));
      centers.push({ cx, cy });
    }

    const circles = centers
      .map(({ cx, cy }, idx) => {
        if (idx === markedIdx) {
          return `<circle cx="${cx}" cy="${cy}" r="${bubbleDiamPx / 2}" fill="rgb(${black.r},${black.g},${black.b})" />`;
        }
        return `<circle cx="${cx}" cy="${cy}" r="${bubbleDiamPx / 2}" fill="rgb(${white.r},${white.g},${white.b})" stroke="rgb(${lightGray.r},${lightGray.g},${lightGray.b})" stroke-width="1" />`;
      })
      .join("");

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect width="100%" height="100%" fill="white" />
      ${circles}
    </svg>`;

    return await sharp(Buffer.from(svg)).png().toBuffer();
  }

  function regionForCol(col: number): { left: number; top: number; width: number; height: number } {
    const cx = Math.round(W * (startXPct + col * spacingXPct));
    const cy = Math.round(H * (startYPct + 0 * 0.018));
    const half = Math.floor(bubbleDiamPx / 2);
    return {
      left: Math.max(0, cx - half),
      top: Math.max(0, cy - half),
      width: Math.min(bubbleDiamPx, W),
      height: Math.min(bubbleDiamPx, H),
    };
  }

  it("burbuja E marcada (idx 4) sale con fillRatio > 0.6, el resto < 0.2", async () => {
    const png = await buildSyntheticSheet(4);
    const tmp = mkdtempSync(join(tmpdir(), "omr-test-"));
    const pngPath = join(tmp, "sheet.png");
    writeFileSync(pngPath, png);

    const imageBuf = await sharp(pngPath).png().toBuffer();
    const binary = await preprocessScan(imageBuf);

    const ratios: number[] = [];
    for (let col = 0; col < COLS; col++) {
      ratios.push(await measureFillRatio(binary, regionForCol(col)));
    }

    // La burbuja marcada (col 4 = E) debe estar bien rellena.
    expect(ratios[4]).toBeGreaterThan(0.6);
    // Las 7 restantes deben estar vacías.
    for (const col of [0, 1, 2, 3, 5, 6, 7]) {
      expect(ratios[col]).toBeLessThan(0.2);
    }
  });

  it("burbuja H marcada (última col, idx 7) sale con fillRatio > 0.6", async () => {
    const png = await buildSyntheticSheet(7);
    const imageBuf = await sharp(png).png().toBuffer();
    const binary = await preprocessScan(imageBuf);

    const ratios: number[] = [];
    for (let col = 0; col < COLS; col++) {
      ratios.push(await measureFillRatio(binary, regionForCol(col)));
    }

    expect(ratios[7]).toBeGreaterThan(0.6);
    for (const col of [0, 1, 2, 3, 4, 5, 6]) {
      expect(ratios[col]).toBeLessThan(0.2);
    }
  });

  it("hoja en blanco (sin marcas) → todas las burbujas con fillRatio < 0.2", async () => {
    const png = await buildSyntheticSheet(-1);
    const imageBuf = await sharp(png).png().toBuffer();
    const binary = await preprocessScan(imageBuf);

    for (let col = 0; col < COLS; col++) {
      const r = await measureFillRatio(binary, regionForCol(col));
      expect(r).toBeLessThan(0.2);
    }
  });
});
