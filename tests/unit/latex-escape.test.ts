/**
 * Tests de la tabla de escape LaTeX (L2 — sep 2026).
 * ==================================================
 *
 * Cubre los 10 caracteres especiales canónicos de pandoc + edge cases:
 *   • Backslash: orden de la tabla (no se doble-escape el `\` introducido
 *     por reemplazos posteriores).
 *   • Posición: inicio / medio / final del string.
 *   • Newlines se colapsan a espacio (en `escapeLatex`).
 *   • Comentarios: newlines se convierten en continuación `% \n% `.
 *   • Texto vacío y null-safe-ish.
 */
import { describe, expect, it } from "vitest";
import { escapeLatex, escapeLatexComment } from "@/modules/latex-export/domain/latex-escape";

describe("escapeLatex", () => {
  // ========================================================================
  // Los 10 caracteres especiales canónicos
  // ========================================================================

  it("escapa backslash como \\char92{}", () => {
    // Usamos `\char92{}` (TeX primitive) en lugar de `\textbackslash{}` para
    // evitar el ciclo de escape: `\textbackslash{}` contiene `{}` que la
    // siguiente regla re-escaparía. `\char92{}` no contiene `{` ni `}`
    // en el output, así que la tabla opera limpio.
    expect(escapeLatex("\\")).toBe("\\char92{}");
    expect(escapeLatex("a\\b")).toBe("a\\char92{}b");
  });

  it("el orden de la tabla evita re-escape del `\\` introducido por reemplazos posteriores", () => {
    // Caso real: input con `\` literal seguido de `&` (p. ej. una ruta
    // Windows tipo `C:\users`). El `\` se escapa primero a `\char92{}`,
    // luego `&` se escapa a `\&`. No se vuelve a re-escribir el `\` que ya
    // está en el output. Si usáramos `\textbackslash{}`, el output sería
    // `\textbackslash\{\}` (válido pero feo) — `\char92{}` es la opción limpia.
    expect(escapeLatex("a\\&b")).toBe("a\\char92{}\\&b");
  });

  it.each([
    ["{", "\\{"],
    ["}", "\\}"],
    ["$", "\\$"],
    ["#", "\\#"],
    ["&", "\\&"],
    ["_", "\\_"],
  ])("escapa %s como %s", (input, expected) => {
    expect(escapeLatex(input)).toBe(expected);
  });

  it("escapa ~ como \\textasciitilde{}", () => {
    expect(escapeLatex("~")).toBe("\\textasciitilde{}");
    expect(escapeLatex("~hello")).toBe("\\textasciitilde{}hello");
  });

  it("escapa ^ como \\textasciicircum{}", () => {
    expect(escapeLatex("^")).toBe("\\textasciicircum{}");
    expect(escapeLatex("a^b")).toBe("a\\textasciicircum{}b");
  });

  it("escapa % como \\%", () => {
    expect(escapeLatex("%")).toBe("\\%");
    expect(escapeLatex("50%")).toBe("50\\%");
  });

  it("escapa < y > como \\textless{} y \\textgreater{}", () => {
    expect(escapeLatex("<")).toBe("\\textless{}");
    expect(escapeLatex(">")).toBe("\\textgreater{}");
    expect(escapeLatex("a<b>c")).toBe("a\\textless{}b\\textgreater{}c");
  });

  // ========================================================================
  // Newlines
  // ========================================================================

  it("colapsa \\n a espacio (los saltos de párrafo los emite el walker)", () => {
    expect(escapeLatex("line1\nline2")).toBe("line1 line2");
    expect(escapeLatex("line1\r\nline2")).toBe("line1 line2");
  });

  it("colapsa múltiples newlines a un solo espacio", () => {
    expect(escapeLatex("a\n\n\nb")).toBe("a   b");
  });

  // ========================================================================
  // Texto multi-char realista
  // ========================================================================

  it("escapa enunciado con varios especiales", () => {
    // El `>` SÍ se escapa (LaTeX no requiere escape fuera de contextos
    // especiales, pero la convención pandoc es escaparlo siempre para
    // portabilidad across paquetes).
    expect(escapeLatex("Si x = 50% y $y > 0$, entonces x & y son válidos.")).toBe(
      "Si x = 50\\% y \\$y \\textgreater{} 0\\$, entonces x \\& y son válidos.",
    );
  });

  it("preserva caracteres no especiales (incluido español)", () => {
    expect(escapeLatex("áéíóúñ ¿¡Hola, mundo!")).toBe("áéíóúñ ¿¡Hola, mundo!");
  });

  it("string vacío devuelve string vacío", () => {
    expect(escapeLatex("")).toBe("");
  });

  it("texto sin especiales devuelve texto idéntico", () => {
    expect(escapeLatex("Hola mundo")).toBe("Hola mundo");
  });
});

describe("escapeLatexComment", () => {
  it("envuelve el texto en `% ...`", () => {
    expect(escapeLatexComment("hola")).toBe("% hola");
  });

  it("NO escapa <, >, ~, ^ — son inofensivos en comentarios", () => {
    expect(escapeLatexComment("a < b > c ~ d ^ e")).toBe("% a < b > c ~ d ^ e");
  });

  it("SÍ escapa {, }, $, #, &, _, \\ — por seguridad", () => {
    expect(escapeLatexComment("{a} $b #c &d _e \\f")).toBe(
      "% \\{a\\} \\$b \\#c \\&d \\_e \\char92{}f",
    );
  });

  it("convierte newlines en continuación de comentario (% \\n% )", () => {
    expect(escapeLatexComment("línea1\nlínea2")).toBe("% línea1\n% línea2");
  });

  it("string vacío devuelve solo `% `", () => {
    expect(escapeLatexComment("")).toBe("% ");
  });
});
