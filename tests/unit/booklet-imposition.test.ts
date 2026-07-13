import { describe, expect, it } from "vitest";
import {
  HALF_TABLOID_PT,
  TABLOID_PT,
  buildImposedPageOrder,
  computeBookletImposition,
  padToMultipleOf4,
} from "@/shared/imposition/booklet";

describe("booklet imposition — saddle-stitch cuadernillo doble carta", () => {
  it("lanza error con entradas inválidas", () => {
    expect(() => computeBookletImposition(0)).toThrow();
    expect(() => computeBookletImposition(-1)).toThrow();
    expect(() => computeBookletImposition(2.5)).toThrow();
  });

  it("padToMultipleOf4 redondea hacia arriba", () => {
    expect(padToMultipleOf4(1)).toBe(4);
    expect(padToMultipleOf4(4)).toBe(4);
    expect(padToMultipleOf4(5)).toBe(8);
    expect(padToMultipleOf4(8)).toBe(8);
    expect(padToMultipleOf4(13)).toBe(16);
  });

  it("N=4 (1 pliego): cubierta y contraportada en FRONT", () => {
    const slots = computeBookletImposition(4);
    expect(slots).toHaveLength(4);

    // Convención Adobe: sheet 1 (exterior) lleva cubierta y contraportada.
    expect(slots).toMatchObject([
      { sheetIndex: 0, face: "FRONT_LEFT", logicalPage: 4 },
      { sheetIndex: 0, face: "FRONT_RIGHT", logicalPage: 1 },
      { sheetIndex: 0, face: "BACK_LEFT", logicalPage: 2 },
      { sheetIndex: 0, face: "BACK_RIGHT", logicalPage: 3 },
    ]);
  });

  it("N=5 (2 pliegos, con blancos al final)", () => {
    const order = buildImposedPageOrder(5);
    // Sheet 1 (exterior): FL=8, FR=1, BL=2, BR=7 → con padding: [null, 1, 2, null]
    // Sheet 2 (interior): FL=6, FR=3, BL=4, BR=5 → [null, 3, 4, 5]
    expect(order).toEqual([null, 1, 2, null, null, 3, 4, 5]);
  });

  it("N=8 (2 pliegos, completo)", () => {
    const order = buildImposedPageOrder(8);
    expect(order).toEqual([
      // Sheet 1 (exterior): FL=8, FR=1, BL=2, BR=7
      8, 1, 2, 7,
      // Sheet 2 (interior): FL=6, FR=3, BL=4, BR=5
      6, 3, 4, 5,
    ]);
  });

  it("N=12 (3 pliegos, completo)", () => {
    const order = buildImposedPageOrder(12);
    expect(order).toHaveLength(12);
    expect(order.every((p) => p !== null)).toBe(true);

    // Sheet 1 (exterior): FL=12, FR=1, BL=2, BR=11
    expect(order.slice(0, 4)).toEqual([12, 1, 2, 11]);
    // Sheet 2: FL=10, FR=3, BL=4, BR=9
    expect(order.slice(4, 8)).toEqual([10, 3, 4, 9]);
    // Sheet 3 (interior): FL=8, FR=5, BL=6, BR=7
    expect(order.slice(8, 12)).toEqual([8, 5, 6, 7]);
  });

  it("N=13 (4 pliegos, 3 blancos al final)", () => {
    const order = buildImposedPageOrder(13);
    expect(order).toHaveLength(16);
    const blanks = order.filter((p) => p === null);
    expect(blanks).toHaveLength(3); // 16 - 13 = 3 blancas
    const filled = order.filter((p) => p !== null);
    expect(filled).toHaveLength(13);
  });

  it("orden de imposition cubre cada página lógica 1..N exactamente una vez (N múltiplo de 4)", () => {
    for (const n of [4, 8, 12, 16, 20]) {
      const order = buildImposedPageOrder(n);
      const filled = order.filter((p): p is number => p !== null).sort((a, b) => a - b);
      expect(filled).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    }
  });

  it("dimensiones: tabloid 17×11 in = 1224×792 pt; mitad = 612×792 pt", () => {
    expect(TABLOID_PT).toEqual({ width: 1224, height: 792 });
    expect(HALF_TABLOID_PT).toEqual({ width: 612, height: 792 });
  });
});
