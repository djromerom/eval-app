/**
 * Tests de `isWideQuestion`: qué preguntas cruzan las dos columnas.
 *
 * A dos columnas cada una mide ~8 cm en una carta; un diagrama o una tabla
 * ahí quedan ilegibles. Si el detector fallara, el docente vería el examen
 * bien en pantalla y con la imagen minúscula en el papel.
 */
import { describe, expect, it } from "vitest";
import { hasWideContent, isWideQuestion } from "@/modules/printing/domain/wide-question";

/** Documento TipTap de un párrafo de texto. */
const texto = (t: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
});

const conImagen = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "image", attrs: { src: "/a.jpg" } }] }],
};

const conTabla = {
  type: "doc",
  content: [
    {
      type: "table",
      content: [{ type: "tableRow", content: [{ type: "tableCell", content: [texto("x")] }] }],
    },
  ],
};

describe("hasWideContent", () => {
  it("detecta una imagen anidada en cualquier nivel", () => {
    expect(hasWideContent(conImagen)).toBe(true);
    expect(
      hasWideContent({
        type: "doc",
        content: [
          {
            type: "blockquote",
            content: [{ type: "paragraph", content: [{ type: "image", attrs: {} }] }],
          },
        ],
      }),
    ).toBe(true);
  });

  it("detecta una tabla", () => {
    expect(hasWideContent(conTabla)).toBe(true);
  });

  it("es falso para texto plano", () => {
    expect(hasWideContent(texto("¿Cuál es la capital?"))).toBe(false);
  });

  it("tolera null, string y estructuras vacías", () => {
    expect(hasWideContent(null)).toBe(false);
    expect(hasWideContent("texto suelto")).toBe(false);
    expect(hasWideContent({})).toBe(false);
    expect(hasWideContent([])).toBe(false);
  });
});

describe("isWideQuestion", () => {
  const base = { text: texto("¿Cuál?"), options: [{ text: "A" }, { text: "B" }] };

  it("una pregunta de solo texto va en columna", () => {
    expect(isWideQuestion(base)).toBe(false);
  });

  it("con imagen en el enunciado cruza las columnas", () => {
    expect(isWideQuestion({ ...base, text: conImagen })).toBe(true);
  });

  it("con tabla en el enunciado cruza las columnas", () => {
    expect(isWideQuestion({ ...base, text: conTabla })).toBe(true);
  });

  it("con imagen en UNA opción cruza las columnas", () => {
    // Caso real: opciones que son gráficas ("¿cuál de estas figuras…?").
    expect(isWideQuestion({ ...base, options: [{ text: "A" }, { text: conImagen }] })).toBe(true);
  });

  it("respeta el campo `image` heredado del modelo", () => {
    // Una pregunta puede traer la imagen por ahí y no dentro del TipTap.
    expect(isWideQuestion({ ...base, image: "/api/uploads/evaluations/i1/a.jpg" })).toBe(true);
    expect(isWideQuestion({ ...base, image: null })).toBe(false);
  });

  it("una pregunta sin opciones no revienta", () => {
    expect(isWideQuestion({ text: texto("x"), options: [] })).toBe(false);
  });
});
