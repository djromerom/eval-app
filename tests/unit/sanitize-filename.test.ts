/**
 * Tests de sanitize-filename (L7 — sep 2026).
 * ============================================
 */
import { describe, expect, it } from "vitest";
import { sanitizeFilename } from "@/modules/latex-export/application/sanitize-filename";

describe("sanitizeFilename", () => {
  it("string vacío devuelve 'untitled'", () => {
    expect(sanitizeFilename("")).toBe("untitled");
  });

  it("input solo de chars prohibidos → 'untitled'", () => {
    expect(sanitizeFilename("///***")).toBe("untitled");
  });

  it("preserva letras, dígitos, guión, guión bajo, punto", () => {
    expect(sanitizeFilename("Mi-Archivo_v1.0")).toBe("mi-archivo_v1.0");
  });

  it("lowercase", () => {
    expect(sanitizeFilename("HolaMundo")).toBe("holamundo");
  });

  it.each([
    ["/", "-"],
    ["\\", "-"],
    [":", "-"],
    ["*", "-"],
    ["?", "-"],
    ['"', "-"],
    ["<", "-"],
    [">", "-"],
    ["|", "-"],
    [" ", "-"],
  ])("reemplaza %s por -", (input, expected) => {
    expect(sanitizeFilename(`a${input}b`)).toBe(`a${expected}b`);
  });

  it("colapsa múltiples guiones en uno", () => {
    expect(sanitizeFilename("a   ---   b")).toBe("a-b");
  });

  it("trim de guiones al inicio/fin", () => {
    expect(sanitizeFilename("---hello---")).toBe("hello");
    expect(sanitizeFilename("__hello__")).toBe("hello");
  });

  it("fold de tildes y caracteres españoles", () => {
    expect(sanitizeFilename("Matemáticas 10°")).toBe("matematicas-10");
    expect(sanitizeFilename("Álgebra")).toBe("algebra");
    expect(sanitizeFilename("Niño")).toBe("nino");
  });

  it("em/en dash → -", () => {
    expect(sanitizeFilename("A — B")).toBe("a-b");
  });

  it("¿ y ¡ se eliminan", () => {
    expect(sanitizeFilename("¿Qué?")).toBe("que");
  });

  it("cap a 80 chars", () => {
    const long = "a".repeat(200);
    expect(sanitizeFilename(long).length).toBe(80);
  });

  it("caso realista: título de evaluación", () => {
    expect(sanitizeFilename("Matemáticas 10° - Periodo I")).toBe("matematicas-10-periodo-i");
  });

  it("caso con caracteres non-ASCII arbitrarios", () => {
    // Caracteres chinos → eliminados (no en ASCII_FALLBACKS ni imprimibles).
    expect(sanitizeFilename("Test 测试 123")).toBe("test-123");
  });
});
