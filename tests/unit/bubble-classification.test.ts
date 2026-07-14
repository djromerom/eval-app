import { describe, expect, it } from "vitest";
import {
  classifyBubble,
  readQuestion,
  type BubbleReading,
  type AnswerKey,
} from "@/modules/scanning/domain/bubble-classification";

const bubbles = (fills: Partial<Record<AnswerKey, number>>): BubbleReading[] =>
  (["A", "B", "C", "D", "E", "F", "G", "H"] as const).map((key) => ({
    key,
    fillRatio: fills[key] ?? 0,
  }));

describe("classifyBubble (umbrales 60/20)", () => {
  it("marca por encima del 60 %", () => {
    expect(classifyBubble(0.61)).toBe("MARKED");
    expect(classifyBubble(0.95)).toBe("MARKED");
  });
  it("vacía por debajo del 20 %", () => {
    expect(classifyBubble(0.05)).toBe("EMPTY");
    expect(classifyBubble(0.19)).toBe("EMPTY");
  });
  it("ambigua entre 20 % y 60 %", () => {
    expect(classifyBubble(0.4)).toBe("AMBIGUOUS");
  });
});

describe("readQuestion (4-columnas heredado)", () => {
  it("una sola marca clara → ANSWERED", () => {
    const r = readQuestion(bubbles({ A: 0.05, B: 0.9, C: 0.03, D: 0.01 }));
    expect(r.status).toBe("ANSWERED");
    expect(r.selectedKey).toBe("B");
    expect(r.confidence).toBeGreaterThan(0);
  });

  it("sin marcas → BLANK", () => {
    const r = readQuestion(bubbles({ A: 0.02, B: 0.03, C: 0.01, D: 0.04 }));
    expect(r.status).toBe("BLANK");
    expect(r.selectedKey).toBeNull();
  });

  it("dos marcas → MULTIPLE", () => {
    const r = readQuestion(bubbles({ A: 0.8, B: 0.75, C: 0.02, D: 0.01 }));
    expect(r.status).toBe("MULTIPLE");
    expect(r.selectedKey).toBeNull();
  });

  it("una burbuja ambigua → REVIEW", () => {
    const r = readQuestion(bubbles({ A: 0.45, B: 0.05, C: 0.02, D: 0.01 }));
    expect(r.status).toBe("REVIEW");
    expect(r.selectedKey).toBeNull();
  });
});

describe("readQuestion (8-columnas A–H)", () => {
  it("marca en columna F → ANSWERED", () => {
    const r = readQuestion(
      bubbles({
        A: 0.02,
        B: 0.03,
        C: 0.04,
        D: 0.01,
        E: 0.02,
        F: 0.9,
        G: 0.01,
        H: 0.02,
      }),
    );
    expect(r.status).toBe("ANSWERED");
    expect(r.selectedKey).toBe("F");
  });
  it("marca en columna H (última) → ANSWERED", () => {
    const r = readQuestion(
      bubbles({
        A: 0.01,
        B: 0.02,
        C: 0.01,
        D: 0.02,
        E: 0.01,
        F: 0.02,
        G: 0.01,
        H: 0.95,
      }),
    );
    expect(r.status).toBe("ANSWERED");
    expect(r.selectedKey).toBe("H");
  });
  it("pregunta con solo 2 opciones (V/F): A marcada, E–H vacías se ignoran", () => {
    const r = readQuestion(bubbles({ A: 0.9, B: 0.02 }));
    expect(r.status).toBe("ANSWERED");
    expect(r.selectedKey).toBe("A");
  });
  it("pregunta con 5 opciones: E marcada, F–H no se consideran", () => {
    const r = readQuestion(bubbles({ E: 0.85 }));
    expect(r.status).toBe("ANSWERED");
    expect(r.selectedKey).toBe("E");
  });
});
