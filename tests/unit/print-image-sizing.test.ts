import { describe, expect, it } from "vitest";
import {
  computeBookletPageBudget,
  computeEffectiveDpi,
  computePrintImageCapPx,
  computePrintImageMetrics,
  DEFAULT_IMAGE_MIN_DPI,
  mmToPx,
  pxToMm,
} from "@/shared/print/image-sizing";

describe("tamaño de impresión de imágenes", () => {
  it("convierte px CSS a mm con la convención 1px = 1/96 de pulgada", () => {
    expect(pxToMm(96)).toBeCloseTo(25.4, 6);
    expect(pxToMm(150)).toBeCloseTo(39.6875, 4);
    expect(mmToPx(25.4)).toBeCloseTo(96, 6);
    expect(mmToPx(pxToMm(322.7))).toBeCloseTo(322.7, 6);
  });

  describe("computePrintImageCapPx — tope absoluto de calidad", () => {
    it("con 96 DPI el tope es el tamaño natural (nunca se amplía)", () => {
      expect(computePrintImageCapPx(150)).toBe(150);
      expect(computePrintImageCapPx(1200)).toBe(1200);
      expect(DEFAULT_IMAGE_MIN_DPI).toBe(96);
    });

    it("con un DPI objetivo mayor, el tope reduce la imagen", () => {
      // 150 px a 150 DPI caben en 96 px (25.4 mm).
      expect(computePrintImageCapPx(150, 150)).toBe(96);
      // 1200 px a 150 DPI caben en 768 px.
      expect(computePrintImageCapPx(1200, 150)).toBe(768);
      // 1200 px a 300 DPI caben en 384 px.
      expect(computePrintImageCapPx(1200, 300)).toBe(384);
    });

    it("nunca amplía aunque se pida menos de 96 DPI", () => {
      // Pedir 48 DPI dejaría ampliar al doble: se recorta al tamaño natural.
      expect(computePrintImageCapPx(150, 48)).toBe(150);
    });

    it("devuelve 0 para tamaños inválidos", () => {
      expect(computePrintImageCapPx(0)).toBe(0);
      expect(computePrintImageCapPx(-10)).toBe(0);
      expect(computePrintImageCapPx(Number.NaN)).toBe(0);
    });
  });

  describe("computeEffectiveDpi", () => {
    it("mide la resolución con la que sale la imagen", () => {
      // Tamaño natural: 96 DPI (lo mismo que en pantalla).
      expect(computeEffectiveDpi(150, 150)).toBeCloseTo(96, 6);
      // Ampliada al doble: la mitad de resolución.
      expect(computeEffectiveDpi(150, 300)).toBeCloseTo(48, 6);
      // El caso que se corregía: 150 px en una columna de 800 px.
      expect(computeEffectiveDpi(150, 800)).toBeCloseTo(18, 6);
      // Reducida: más resolución que en pantalla.
      expect(computeEffectiveDpi(1200, 664.6)).toBeCloseTo(173.4, 0);
    });

    it("devuelve 0 si no hay ancho o no hay imagen", () => {
      expect(computeEffectiveDpi(150, 0)).toBe(0);
      expect(computeEffectiveDpi(0, 150)).toBe(0);
    });
  });

  describe("computePrintImageMetrics", () => {
    it("recorta cuando el docente pidió más ancho del que tiene la imagen", () => {
      const metrics = computePrintImageMetrics({
        naturalWidth: 150,
        naturalHeight: 100,
        requestedWidth: 800,
        capPx: 150,
      });

      expect(metrics.clamped).toBe(true);
      expect(metrics.finalWidth).toBe(150);
      expect(metrics.finalWidthMm).toBeCloseTo(39.6875, 3);
      // La proporción se conserva: 150×100 → 39.69 × 26.46 mm.
      expect(metrics.finalHeightMm).toBeCloseTo(26.4583, 3);
      expect(metrics.dpi).toBeCloseTo(96, 6);
      // Lo que se iba a imprimir (800 px = 211.7 mm) era ilegible.
      expect(metrics.requestedDpi).toBeCloseTo(18, 6);
      expect(metrics.requestedWidthMm).toBeCloseTo(211.6667, 3);
    });

    it("respeta el ancho pedido cuando la imagen tiene resolución de sobra", () => {
      const metrics = computePrintImageMetrics({
        naturalWidth: 1200,
        naturalHeight: 800,
        requestedWidth: 322.7,
        capPx: 1200,
      });

      expect(metrics.clamped).toBe(false);
      expect(metrics.finalWidth).toBeCloseTo(322.7, 6);
      expect(metrics.dpi).toBeCloseTo(357.0, 0);
    });

    it("el alto nunca supera el del archivo (no se deforma)", () => {
      const metrics = computePrintImageMetrics({
        naturalWidth: 600,
        naturalHeight: 400,
        requestedWidth: 800,
        capPx: 600,
      });
      expect(metrics.finalHeightMm).toBeCloseTo(pxToMm(400), 6);
    });
  });

  describe("computeBookletPageBudget — múltiplos de 4", () => {
    it("sin páginas en blanco cuando el contenido ya es múltiplo de 4", () => {
      expect(computeBookletPageBudget(12)).toEqual({
        contentPages: 12,
        paddedPages: 12,
        sheets: 3,
        blankPages: 0,
      });
      expect(computeBookletPageBudget(16)).toEqual({
        contentPages: 16,
        paddedPages: 16,
        sheets: 4,
        blankPages: 0,
      });
    });

    it("pagina en blanco lo que sobra del pliego", () => {
      expect(computeBookletPageBudget(13)).toEqual({
        contentPages: 13,
        paddedPages: 16,
        sheets: 4,
        blankPages: 3,
      });
      expect(computeBookletPageBudget(1)).toEqual({
        contentPages: 1,
        paddedPages: 4,
        sheets: 1,
        blankPages: 3,
      });
    });

    it("tolera entradas inválidas", () => {
      expect(computeBookletPageBudget(0)).toEqual({
        contentPages: 0,
        paddedPages: 0,
        sheets: 0,
        blankPages: 0,
      });
      expect(computeBookletPageBudget(-5).contentPages).toBe(0);
    });
  });
});
