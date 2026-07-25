import { describe, expect, it } from "vitest";
import { estimatedMinutes } from "@/app/(dashboard)/teacher/evaluations/[id]/contexts/contexts-view-helpers";

/**
 * El índice de contextos es una vista cliente muy delgada: recibe
 * `ContextCardData[]` ya derivado del server component. Lo único testeable
 * sin jsdom es la fórmula de tiempo estimado que se muestra en cada card.
 *
 * El render visual y la navegación se cubren en tests/e2e/contextos.spec.ts.
 */
describe("estimatedMinutes (contexts-index)", () => {
  it("devuelve mínimo 2 min aunque el conteo sea 0", () => {
    expect(estimatedMinutes(0)).toBe(2);
  });

  it("aproxima 2.5 min por pregunta para una sola pregunta", () => {
    // 1 * 2.5 = 2.5 → redondeo a 3, pero el mínimo es 2 → gana 3.
    expect(estimatedMinutes(1)).toBe(3);
  });

  it("redondea hacia el entero más cercano", () => {
    // 4 * 2.5 = 10.0 → 10
    expect(estimatedMinutes(4)).toBe(10);
    // 5 * 2.5 = 12.5 → 13
    expect(estimatedMinutes(5)).toBe(13);
  });

  it("crece linealmente con preguntas grandes", () => {
    expect(estimatedMinutes(20)).toBe(50);
    expect(estimatedMinutes(40)).toBe(100);
  });

  it("nunca cae por debajo del piso de 2 min", () => {
    expect(estimatedMinutes(0)).toBeGreaterThanOrEqual(2);
    expect(estimatedMinutes(1)).toBeGreaterThanOrEqual(2);
  });
});
