import { describe, it, expect } from "vitest";
import { inferGrid } from "@/modules/scanning/infrastructure/grid-inference";
import type { DetectedBubble } from "@/modules/scanning/infrastructure/bubble-detector";

/** Helper: crea un grid rectangular de DetectedBubble de `cols × rows`
 *  con el spacing dado. */
function makeRectGrid(
  cols: number,
  rows: number,
  startX: number,
  startY: number,
  spacingX: number,
  spacingY: number,
  bubbleW = 20,
  bubbleH = 20,
): DetectedBubble[] {
  const out: DetectedBubble[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({
        cx: startX + c * spacingX,
        cy: startY + r * spacingY,
        w: bubbleW,
        h: bubbleH,
        density: 0.7,
      });
    }
  }
  return out;
}

describe("grid-inference", () => {
  it("infers a single-column grid (1-col legacy)", () => {
    // 8 cols × 5 rows en una sola banda.
    const bubbles = makeRectGrid(8, 5, 100, 100, 40, 40);
    const result = inferGrid({
      bubbles,
      expectedQuestions: 5,
      expectedCols: 8,
    });
    expect(result.ok).toBe(true);
    expect(result.questions.length).toBe(5);
    expect(result.questions[0]!.cells.length).toBe(8);
  });

  it("infers a 3-column bundle grid (37/37/36 rows × 8 cols)", () => {
    // Simula una hoja de compendio con 3 bandas verticales de 8 columnas.
    // Cada banda tiene preguntas apiladas verticalmente.
    // gap entre bandas (150px) >> spacing X entre opciones (40px) para que
    // el split X-first separe correctamente.
    const bandRows = [37, 37, 36];
    const bubbles: DetectedBubble[] = [];
    bandRows.forEach((rows, bandIdx) => {
      const bandStartX = 100 + bandIdx * (8 * 40 + 150); // gap entre bandas
      const bandStartY = 100;
      bubbles.push(...makeRectGrid(8, rows, bandStartX, bandStartY, 40, 30));
    });
    const result = inferGrid({
      bubbles,
      expectedQuestions: 110,
      expectedCols: 8,
    });
    expect(result.ok).toBe(true);
    expect(result.questions.length).toBe(110);
    // Cada pregunta tiene 8 celdas.
    expect(result.questions[0]!.cells.length).toBe(8);
    expect(result.questions[109]!.cells.length).toBe(8);
  });

  it("tolerates per-bubble jitter like a real scan (regression)", () => {
    // REGRESIÓN: con una hoja escaneada real, `inferGrid` devolvía
    // `colsPerRow` moda = 2 en vez de 8 y caía al layout calibrado. La
    // causa era que el umbral de clustering salía de `median(gaps)`: en
    // un grid PERFECTO las burbujas de una columna comparten `cx` exacto
    // y la mediana da el spacing real, pero con jitter de ±3 px la lista
    // ordenada se llena de gaps diminutos, la mediana colapsa a ~2 px y
    // cada columna de opciones se convierte en su propia banda.
    //
    // Este test replica ese jitter, así que falla con el código viejo y
    // pasa con el umbral derivado del diámetro de burbuja.
    const bandRows = [37, 37, 36];
    const bubbles: DetectedBubble[] = [];
    // PRNG determinista — un test flaky aquí sería peor que no tenerlo.
    let seed = 42;
    const jitter = (amplitude: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return ((seed / 2147483648) * 2 - 1) * amplitude;
    };
    bandRows.forEach((rows, bandIdx) => {
      const bandStartX = 100 + bandIdx * (8 * 40 + 150);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < 8; c++) {
          bubbles.push({
            cx: bandStartX + c * 40 + jitter(3),
            cy: 100 + r * 30 + jitter(3),
            w: 20 + jitter(1),
            h: 20 + jitter(1),
            density: 0.7,
          });
        }
      }
    });
    const result = inferGrid({ bubbles, expectedQuestions: 110, expectedCols: 8 });
    expect(result.reason).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.questions.length).toBe(110);
    expect(result.questions[0]!.cells.length).toBe(8);
  });

  it("returns ok=false when bubbles is empty", () => {
    const result = inferGrid({ bubbles: [], expectedQuestions: 10, expectedCols: 8 });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no bubbles detected");
  });

  it("returns ok=false when colsPerRow is inconsistent", () => {
    // Una fila de 8 + otra fila de 4 + otra fila de 8 — mode=8 pero solo
    // 2/3 = 66% de filas coinciden. Por debajo del umbral del 80%.
    const bubbles: DetectedBubble[] = [
      ...makeRectGrid(8, 1, 100, 100, 40, 40),
      ...makeRectGrid(4, 1, 100, 160, 40, 40),
      ...makeRectGrid(8, 1, 100, 220, 40, 40),
    ];
    const result = inferGrid({ bubbles, expectedQuestions: 3, expectedCols: 8 });
    expect(result.ok).toBe(false);
  });

  it("validates inputs (rejects expectedQuestions <= 0)", () => {
    const bubbles = makeRectGrid(8, 1, 0, 0, 40, 40);
    const result = inferGrid({ bubbles, expectedQuestions: 0, expectedCols: 8 });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid expected counts");
  });
});
