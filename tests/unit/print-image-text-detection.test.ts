/**
 * Pruebas de la detección de texto dentro de las imágenes y del cálculo del
 * ancho mínimo con el que se pueden imprimir sin que su texto sea ilegible.
 *
 * El caso que motiva todo esto: la tarjeta "NORMAS EN EL AULA TIC" (548×116
 * px, rótulos de 10 px) se imprimía a 35 mm y esos rótulos quedaban en
 * 1,8 pt — ilegibles. Con el piso calculado salen a 116 mm y el texto llega
 * a 6 pt.
 */
import { describe, expect, it } from "vitest";

import {
  boxBlurGray,
  detectTextBandHeights,
  MIN_PRINT_TEXT_PT,
  PT_PER_PX,
  resolveTextFloor,
} from "@/shared/print/image-text-detection";
import { PRINT_SHEET_WIDTH_MM, pxToMm } from "@/shared/print/image-sizing";

/** Imagen sintética en escala de grises. */
function makeImage(
  width: number,
  height: number,
): {
  gray: Uint8ClampedArray;
  background: Float64Array;
} {
  const gray = new Uint8ClampedArray(width * height).fill(248);
  const background = new Float64Array(width * height).fill(248);
  return { gray, background };
}

/**
 * Dibuja una línea de "letras": trazos verticales de `strokeWidth` px cada
 * `strokeWidth + gap` px, sobre una banda de `lineHeight` filas.
 */
function drawTextLine(
  gray: Uint8ClampedArray,
  width: number,
  top: number,
  lineHeight: number,
  strokeWidth: number,
  gap: number,
): void {
  for (let y = top; y < top + lineHeight; y++) {
    for (let x = 2; x < width - 2; x += strokeWidth + gap) {
      for (let s = 0; s < strokeWidth; s++) {
        gray[y * width + x + s] = 20;
      }
    }
  }
}

describe("boxBlurGray", () => {
  it("devuelve el mismo tamaño que la imagen", () => {
    const { gray } = makeImage(8, 6);
    const bg = boxBlurGray(gray, 8, 6, 2);
    expect(bg).toHaveLength(8 * 6);
  });

  it("suaviza: en una imagen a medio половиja, el valor medio baja", () => {
    const width = 20;
    const height = 20;
    const gray = new Uint8ClampedArray(width * height).fill(255);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < 10; x++) gray[y * width + x] = 0;
    }
    const bg = boxBlurGray(gray, width, height, 3);
    // En la zona negra (x=0..9) la ventana es toda negra.
    expect(bg[0]).toBe(0);
    // En la frontera (x=8) la ventana ya alcanza la zona blanca.
    expect(bg[8]).toBeGreaterThan(0);
    expect(bg[8]).toBeLessThan(255);
    // En la zona blanca el fondo vuelve a ser blanco.
    expect(bg[15]).toBe(255);
  });
});

describe("detectTextBandHeights", () => {
  it("detecta la altura de una línea de texto dibujada", () => {
    const width = 120;
    const height = 60;
    const { gray, background } = makeImage(width, height);
    drawTextLine(gray, width, 20, 12, 5, 3);

    const heights = detectTextBandHeights(gray, background, width, height);
    expect(heights).toEqual([12]);
  });

  it("detecta varias líneas con alturas distintas", () => {
    const width = 120;
    const height = 80;
    const { gray, background } = makeImage(width, height);
    drawTextLine(gray, width, 10, 12, 5, 3);
    drawTextLine(gray, width, 40, 8, 5, 3);

    const heights = detectTextBandHeights(gray, background, width, height);
    expect(heights).toHaveLength(2);
    expect(heights).toContain(12);
    expect(heights).toContain(8);
  });

  it("NO confunde un muro de ladrillos con texto", () => {
    // Líneas horizontales cada 5 px con juntas verticales: el patrón tiene
    // "forma" de banda, pero no tiene cuerpo (solo se encienden unas filas).
    const width = 120;
    const height = 30;
    const { gray, background } = makeImage(width, height);
    for (let y = 0; y < height; y += 5) {
      for (let x = 0; x < width; x++) gray[y * width + x] = 30;
    }
    for (let y = 0; y < height; y += 10) {
      for (let x = 20; x < width; x += 40) {
        for (let k = 0; k < 5; k++) gray[(y + k) * width + x] = 30;
      }
    }

    expect(detectTextBandHeights(gray, background, width, height)).toEqual([]);
  });

  it("NO detecta texto en una imagen sin tinta", () => {
    const { gray, background } = makeImage(60, 40);
    expect(detectTextBandHeights(gray, background, 60, 40)).toEqual([]);
  });

  it("no revienta con una imagen diminuta", () => {
    const { gray, background } = makeImage(2, 2);
    expect(detectTextBandHeights(gray, background, 2, 2)).toEqual([]);
  });
});

describe("resolveTextFloor", () => {
  it("sin texto no toca el ancho", () => {
    const res = resolveTextFloor({
      currentWidthMm: 35,
      naturalWidthPx: 548,
      minTextHeightPx: null,
      sheetWidthMm: PRINT_SHEET_WIDTH_MM,
    });
    expect(res.widthMm).toBeNull();
    expect(res.reason).toBe("sin-texto");
  });

  it("calcula el ancho mínimo de la tarjeta de 10 px de texto", () => {
    // 548 px naturales = 145,0 mm. El texto de 10 px mide 7,5 pt a tamaño
    // natural, así que para llegar a 6 pt la imagen tiene que ir a 80 % de
    // su tamaño natural: 116,0 mm.
    const res = resolveTextFloor({
      currentWidthMm: 41.8,
      naturalWidthPx: 548,
      minTextHeightPx: 10,
      sheetWidthMm: PRINT_SHEET_WIDTH_MM,
    });
    expect(res.reason).toBe("ajustado");
    expect(res.widthMm).toBeCloseTo(116.0, 1);
  });

  it("respeta el ancho del docente si el texto ya se lee bien", () => {
    const res = resolveTextFloor({
      currentWidthMm: 140,
      naturalWidthPx: 548,
      minTextHeightPx: 10,
      sheetWidthMm: PRINT_SHEET_WIDTH_MM,
    });
    expect(res.widthMm).toBeNull();
    expect(res.reason).toBe("ya-legible");
  });

  it("no agranda más allá del tamaño natural (nunca se amplían píxeles)", () => {
    // Texto de 2 px: a tamaño natural mide 1,5 pt, muy por debajo del
    // mínimo. Ningún tamaño lo arregla, así que la imagen se deja como está
    // (y no se amplía más allá de sus 145,0 mm).
    const res = resolveTextFloor({
      currentWidthMm: 20,
      naturalWidthPx: 548,
      minTextHeightPx: 2,
      sheetWidthMm: PRINT_SHEET_WIDTH_MM,
    });
    expect(res.reason).toBe("ilegible");
    expect(res.widthMm).toBeNull();
  });

  it("no toca la imagen si su texto no cabe ni en la hoja completa", () => {
    // Captura de 1200 px con texto de 10 px: necesitaría 254 mm y la hoja
    // tiene 175,9. Agrandarla solo gastaría papel.
    const res = resolveTextFloor({
      currentWidthMm: 35,
      naturalWidthPx: 1200,
      minTextHeightPx: 10,
      sheetWidthMm: PRINT_SHEET_WIDTH_MM,
    });
    expect(res.widthMm).toBeNull();
    expect(res.reason).toBe("fuera-de-hoja");
  });

  it("no toca la imagen si su texto es ilegible aunque se amplíe", () => {
    // Una captura de 400 px con texto de 6 px: a tamaño natural (105,8 mm)
    // ese texto mide 4,5 pt. Ningún tamaño lo arregla — habría que
    // re-exportar la captura con más resolución.
    const res = resolveTextFloor({
      currentWidthMm: 30,
      naturalWidthPx: 400,
      minTextHeightPx: 6,
      sheetWidthMm: PRINT_SHEET_WIDTH_MM,
    });
    expect(res.reason).toBe("ilegible");
    expect(res.widthMm).toBeNull();
  });

  it("el texto de 8 px lleva la imagen hasta su tamaño natural", () => {
    // 8 px de texto = 6 pt a tamaño natural: el mínimo se alcanza justo en
    // el tamaño natural del archivo.
    const res = resolveTextFloor({
      currentWidthMm: 30,
      naturalWidthPx: 400,
      minTextHeightPx: 8,
      sheetWidthMm: PRINT_SHEET_WIDTH_MM,
    });
    expect(res.reason).toBe("ajustado");
    expect(res.widthMm).toBeCloseTo(pxToMm(400), 3);
  });

  it("el texto grande solo necesita una parte de la imagen", () => {
    // 20 px de texto = 15 pt a tamaño natural: para bajar a 6 pt basta con
    // el 40 % del ancho natural.
    const res = resolveTextFloor({
      currentWidthMm: 30,
      naturalWidthPx: 400,
      minTextHeightPx: 20,
      sheetWidthMm: PRINT_SHEET_WIDTH_MM,
    });
    expect(res.reason).toBe("ajustado");
    expect(res.widthMm).toBeCloseTo(pxToMm(400) * 0.4, 3);
  });
});

describe("constantes de impresión", () => {
  it("la hoja imprimible son 175,9 mm (carta con márgenes de 2 cm)", () => {
    expect(PRINT_SHEET_WIDTH_MM).toBeCloseTo(175.9, 1);
  });

  it("1 px CSS son 0,75 pt", () => {
    expect(PT_PER_PX).toBeCloseTo(0.75, 5);
  });

  it("el umbral de texto legible es 6 pt", () => {
    expect(MIN_PRINT_TEXT_PT).toBe(6);
  });
});
