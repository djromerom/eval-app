import { describe, it, expect } from "vitest";
import {
  fitAffine,
  applyAffine,
  residualError,
  affineScale,
  fitToImage,
  type Affine,
} from "@/modules/scanning/domain/registration";

/** Aplica una transformación conocida a puntos, para generar casos donde la
 *  respuesta correcta se sabe de antemano. */
function transformAll(t: Affine, pts: { x: number; y: number }[]) {
  return pts.map((p) => applyAffine(t, p));
}

const SQUARE = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
];

describe("registration", () => {
  it("recupera exactamente una transformación de escala + traslación", () => {
    const truth: Affine = { a: 1500, b: 0, c: 0, d: 1900, tx: -20, ty: 150 };
    const fitted = fitAffine(SQUARE, transformAll(truth, SQUARE));
    expect(fitted).not.toBeNull();
    for (const k of ["a", "b", "c", "d", "tx", "ty"] as const) {
      expect(fitted![k]).toBeCloseTo(truth[k], 6);
    }
  });

  it("recupera una rotación pequeña como la de un escáner", () => {
    // 1.5° de rotación con escala 1600 — el orden de magnitud real medido.
    const rad = (1.5 * Math.PI) / 180;
    const s = 1600;
    const truth: Affine = {
      a: s * Math.cos(rad),
      b: s * Math.sin(rad),
      c: -s * Math.sin(rad),
      d: s * Math.cos(rad),
      tx: 30,
      ty: 45,
    };
    const fitted = fitAffine(SQUARE, transformAll(truth, SQUARE))!;
    const recoveredDeg = (Math.atan2(fitted.b, fitted.a) * 180) / Math.PI;
    expect(recoveredDeg).toBeCloseTo(1.5, 4);
    expect(affineScale(fitted).sx).toBeCloseTo(s, 3);
  });

  it("promedia el ruido de detección en vez de seguirlo punto a punto", () => {
    const truth: Affine = { a: 1500, b: 0, c: 0, d: 1900, tx: 0, ty: 0 };
    const exact = transformAll(truth, SQUARE);
    // Ruido determinista de ±2 px, opuesto entre pares para que promedie ~0.
    const noisy = exact.map((p, i) => ({
      x: p.x + (i % 2 === 0 ? 2 : -2),
      y: p.y + (i < 2 ? 2 : -2),
    }));
    const fitted = fitAffine(SQUARE, noisy)!;
    // La escala apenas se mueve pese al ruido en cada punto.
    expect(affineScale(fitted).sx).toBeGreaterThan(1490);
    expect(affineScale(fitted).sx).toBeLessThan(1510);
    // Y el residual refleja el ruido introducido, no cero.
    expect(residualError(fitted, SQUARE, noisy)).toBeGreaterThan(0.5);
  });

  it("devuelve null con menos de 3 correspondencias", () => {
    expect(fitAffine(SQUARE.slice(0, 2), SQUARE.slice(0, 2))).toBeNull();
  });

  it("devuelve null si los puntos son colineales (sistema singular)", () => {
    const collinear = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ];
    expect(
      fitAffine(
        collinear,
        collinear.map((p) => ({ x: p.x * 2, y: p.y * 2 })),
      ),
    ).toBeNull();
  });

  it("devuelve null si las listas tienen distinta longitud", () => {
    expect(fitAffine(SQUARE, SQUARE.slice(0, 3))).toBeNull();
  });

  it("fitToImage mapea el cuadrado unidad a la imagen completa", () => {
    const t = fitToImage(1704, 2200);
    expect(applyAffine(t, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(applyAffine(t, { x: 1, y: 1 })).toEqual({ x: 1704, y: 2200 });
  });
});
