import { describe, expect, it } from "vitest";
import {
  computeAnswerSheetLayout,
  computeRowWidthMm,
  MAX_OPTIONS,
  MIN_OPTIONS,
  type LayoutQuestion,
} from "@/modules/printing/domain/answer-sheet-layout";

/**
 * Helper para generar N preguntas con optionsLength uniforme.
 */
function questions(count: number, optionsLength: number, startNumber = 1): LayoutQuestion[] {
  return Array.from({ length: count }, (_, i) => ({
    number: startNumber + i,
    optionsLength,
  }));
}

describe("answer-sheet-layout — opciones variables (2..8) y page breaks", () => {
  describe("computeRowWidthMm", () => {
    it("crece monótonamente con optionsLength", () => {
      const widths: number[] = [];
      for (let n = MIN_OPTIONS; n <= MAX_OPTIONS; n++) {
        widths.push(computeRowWidthMm(n, 4));
      }
      for (let i = 1; i < widths.length; i++) {
        expect(widths[i]).toBeGreaterThan(widths[i - 1]!);
      }
    });

    it("8 columnas > 4 columnas (caso del ejemplo real)", () => {
      const w4 = computeRowWidthMm(4, 4);
      const w8 = computeRowWidthMm(8, 4);
      // 4 columnas de diferencia * 10mm de spacing = 40mm extra mínimo
      expect(w8 - w4).toBeGreaterThanOrEqual(40 - 0.01);
    });

    it("incluye el padding interno a izquierda y derecha", () => {
      const padding = 5;
      const w = computeRowWidthMm(4, padding);
      // 2*padding + (4-1)*10mm + 6mm bubble = 10 + 30 + 6 = 46mm
      expect(w).toBeCloseTo(46, 5);
    });
  });

  describe("computeAnswerSheetLayout — caso uniforme", () => {
    it("layout de 10 preguntas con 4 opciones cabe en una página", () => {
      const layout = computeAnswerSheetLayout({
        questions: questions(10, 4),
        blockWidthMm: 300,
        blockHeightMm: 200,
      });
      expect(layout.totalQuestions).toBe(10);
      expect(layout.totalPages).toBeGreaterThanOrEqual(1);
      const allRows = layout.pages.flatMap((p) => p.rows);
      expect(allRows).toHaveLength(10);
      for (const row of allRows) {
        expect(row.columns).toBe(4);
        expect(row.bubbles).toHaveLength(4);
        expect(row.bubbles.map((b) => b.letter)).toEqual(["A", "B", "C", "D"]);
      }
    });

    it("layout de 200 preguntas con 4 opciones se divide en varias páginas", () => {
      const layout = computeAnswerSheetLayout({
        questions: questions(200, 4),
        blockWidthMm: 300,
        blockHeightMm: 200,
      });
      expect(layout.totalQuestions).toBe(200);
      expect(layout.totalPages).toBeGreaterThan(1);
      // Cada página tiene al menos 1 fila y la suma es 200
      const totalRows = layout.pages.reduce((s, p) => s + p.rows.length, 0);
      expect(totalRows).toBe(200);
    });
  });

  describe("computeAnswerSheetLayout — opciones variables", () => {
    it("mezcla 4-opciones y 8-opciones en la misma hoja: cada fila respeta su columns", () => {
      const qs: LayoutQuestion[] = [
        { number: 1, optionsLength: 4 },
        { number: 2, optionsLength: 4 },
        { number: 60, optionsLength: 8 }, // caso del ejemplo real
        { number: 61, optionsLength: 8 },
        { number: 62, optionsLength: 8 },
        { number: 63, optionsLength: 8 },
        { number: 64, optionsLength: 8 },
        { number: 65, optionsLength: 8 },
        { number: 66, optionsLength: 4 },
      ];
      const layout = computeAnswerSheetLayout({
        questions: qs,
        blockWidthMm: 400, // ancho generoso para que quepan ambas
        blockHeightMm: 200,
      });

      const allRows = layout.pages.flatMap((p) => p.rows);
      expect(allRows).toHaveLength(9);
      expect(allRows[0]!.columns).toBe(4);
      expect(allRows[0]!.bubbles.map((b) => b.letter)).toEqual(["A", "B", "C", "D"]);
      expect(allRows[2]!.columns).toBe(8);
      expect(allRows[2]!.bubbles.map((b) => b.letter)).toEqual([
        "A",
        "B",
        "C",
        "D",
        "E",
        "F",
        "G",
        "H",
      ]);
      // Fila de 8 opciones es estrictamente más ancha que la de 4
      expect(allRows[2]!.widthMm).toBeGreaterThan(allRows[0]!.widthMm);
    });

    it("opciones en el límite superior (8) generan 8 burbujas con letras A-H", () => {
      const layout = computeAnswerSheetLayout({
        questions: [{ number: 1, optionsLength: 8 }],
        blockWidthMm: 200,
        blockHeightMm: 100,
      });
      const row = layout.pages[0]!.rows[0]!;
      expect(row.columns).toBe(8);
      expect(row.bubbles.map((b) => b.letter)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"]);
    });

    it("opciones en el límite inferior (2) generan 2 burbujas con letras A-B", () => {
      const layout = computeAnswerSheetLayout({
        questions: [{ number: 1, optionsLength: 2 }],
        blockWidthMm: 200,
        blockHeightMm: 100,
      });
      const row = layout.pages[0]!.rows[0]!;
      expect(row.columns).toBe(2);
      expect(row.bubbles.map((b) => b.letter)).toEqual(["A", "B"]);
    });
  });

  describe("page breaks", () => {
    it("pregunta de 8 columnas que no entra horizontalmente salta a nueva página", () => {
      // Bloque estrecho: las filas de 4 opciones caben pero las de 8 no.
      const layout = computeAnswerSheetLayout({
        questions: [
          { number: 1, optionsLength: 4 },
          { number: 2, optionsLength: 8 }, // overflow horizontal esperado
          { number: 3, optionsLength: 4 },
        ],
        blockWidthMm: 60, // ~60mm: cabe una fila de 4 (46mm) pero no de 8 (86mm)
        blockHeightMm: 200,
      });
      // Debe haber al menos 2 páginas: la primera con [pregunta 1], la segunda
      // con [pregunta 2] (que no entró) y luego la 3 si cabe.
      expect(layout.totalPages).toBeGreaterThanOrEqual(2);
    });

    it("preguntas que no entran verticalmente se reparten en múltiples páginas", () => {
      const layout = computeAnswerSheetLayout({
        questions: questions(50, 4),
        blockWidthMm: 300,
        blockHeightMm: 50, // bloque muy bajo → muchas páginas
      });
      expect(layout.totalPages).toBeGreaterThan(5);
    });
  });

  describe("invariantes y errores", () => {
    it("lanza si optionsLength < 2", () => {
      expect(() =>
        computeAnswerSheetLayout({
          questions: [{ number: 1, optionsLength: 1 }],
          blockWidthMm: 200,
          blockHeightMm: 100,
        }),
      ).toThrow();
    });

    it("lanza si optionsLength > 8", () => {
      expect(() =>
        computeAnswerSheetLayout({
          questions: [{ number: 1, optionsLength: 9 }],
          blockWidthMm: 200,
          blockHeightMm: 100,
        }),
      ).toThrow();
    });

    it("lanza si questionNumber no es entero positivo", () => {
      expect(() =>
        computeAnswerSheetLayout({
          questions: [{ number: 0, optionsLength: 4 }],
          blockWidthMm: 200,
          blockHeightMm: 100,
        }),
      ).toThrow();
      expect(() =>
        computeAnswerSheetLayout({
          questions: [{ number: 1.5, optionsLength: 4 }],
          blockWidthMm: 200,
          blockHeightMm: 100,
        }),
      ).toThrow();
    });

    it("lanza si blockWidthMm <= 0", () => {
      expect(() =>
        computeAnswerSheetLayout({
          questions: [{ number: 1, optionsLength: 4 }],
          blockWidthMm: 0,
          blockHeightMm: 100,
        }),
      ).toThrow();
    });

    it("lanza si innerPaddingMm excede el bloque", () => {
      expect(() =>
        computeAnswerSheetLayout({
          questions: [{ number: 1, optionsLength: 4 }],
          blockWidthMm: 10,
          blockHeightMm: 100,
          innerPaddingMm: 6, // 2*6 > 10
        }),
      ).toThrow();
    });

    it("no acepta preguntas vacías (cuestión trivial: layout de 1 página con 0 filas)", () => {
      const layout = computeAnswerSheetLayout({
        questions: [],
        blockWidthMm: 200,
        blockHeightMm: 100,
      });
      // No hay páginas con filas; totalPages >= 1 para que el caller tenga
      // al menos una página en blanco para mostrar headers si quiere.
      expect(layout.totalQuestions).toBe(0);
      expect(layout.pages).toHaveLength(0);
      expect(layout.totalPages).toBe(1);
    });
  });
});
