import { describe, expect, it } from "vitest";
import { isComplexOption } from "@/app/(dashboard)/teacher/evaluations/[id]/unified/option-text";

/**
 * Cubre \`isComplexOption\` (ago 2026, pedido del docente): el helper
 * decide si el OptionInput del QuestionForm debe renderizar un Input
 * plano o un RichTextEditor variant="option".
 *
 * Regla: true si el doc TipTap contiene math-inline, math-block,
 * image o tableBlock. false en cualquier otro caso (string plano,
 * doc vacío, paragraphs sin nodos especiales).
 *
 * El test no necesita importar React ni renderizar el componente —
 * solo cubre la función pura, que es la única lógica de decisión.
 */
describe("isComplexOption", () => {
  it("string vacío → false (no es complejo)", () => {
    expect(isComplexOption("")).toBe(false);
  });

  it("string con texto plano → false", () => {
    expect(isComplexOption("x^2+1")).toBe(false);
    expect(isComplexOption("Una explicación ICFES válida")).toBe(false);
  });

  it("TipTap doc sin nodos complejos → false", () => {
    expect(isComplexOption({ type: "doc", content: [] })).toBe(false);
    expect(
      isComplexOption({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "hola" }] }],
      }),
    ).toBe(false);
  });

  it("null / undefined / número → false (no es complejo)", () => {
    expect(isComplexOption(null)).toBe(false);
    expect(isComplexOption(undefined)).toBe(false);
    expect(isComplexOption(42)).toBe(false);
  });

  it("math-inline → true", () => {
    expect(
      isComplexOption({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "math-inline", attrs: { tex: "x^2" } }],
          },
        ],
      }),
    ).toBe(true);
  });

  it("math-block → true", () => {
    expect(
      isComplexOption({
        type: "doc",
        content: [{ type: "math-block", attrs: { tex: "x^2 + y^2 = z^2" } }],
      }),
    ).toBe(true);
  });

  it("image → true", () => {
    expect(
      isComplexOption({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Antes de " },
              {
                type: "image",
                attrs: {
                  src: "/uploads/diagrama.png",
                  alt: "Diagrama",
                  width: 320,
                },
              },
              { type: "text", text: " después." },
            ],
          },
        ],
      }),
    ).toBe(true);
  });

  it("tableBlock → true", () => {
    expect(
      isComplexOption({
        type: "doc",
        content: [
          {
            type: "tableBlock",
            content: [
              {
                type: "tableRow",
                content: [
                  { type: "tableHeader", content: [{ type: "paragraph" }] },
                  { type: "tableCell", content: [{ type: "paragraph" }] },
                ],
              },
            ],
          },
        ],
      }),
    ).toBe(true);
  });

  it("doc solo con paragraph + text → false (no dispara RichTextEditor)", () => {
    // Regresión: una opción larga con varias palabras NO debe abrir
    // el RichTextEditor; eso sería ruido visual para el 90% de los
    // casos. La detección es por nodo, no por longitud.
    const longOption = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Una opción larga de varias palabras para validar que el helper NO se confunde con texto plano.",
            },
          ],
        },
      ],
    };
    expect(isComplexOption(longOption)).toBe(false);
  });

  it("mezcla de nodos complejos en distintos párrafos → true", () => {
    // Caso real: una opción que combina texto, fórmula y descripción.
    expect(
      isComplexOption({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "x = " },
              { type: "math-inline", attrs: { tex: "\\frac{-b}{2a}" } },
            ],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "es el vértice de la parábola." }],
          },
        ],
      }),
    ).toBe(true);
  });
});
