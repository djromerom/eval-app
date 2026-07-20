/**
 * Tests de la alineación de párrafos e imágenes.
 *
 * Lo crítico es que llegue al HTML que renderiza el SERVIDOR para el PDF.
 * `@tiptap/extension-text-align` la emite como `style="text-align:…"`, y ese
 * DOM descarta `style` al sanitizar: la alineación se vería en el editor y
 * desaparecería en el papel. Por eso se emite como clase, y esto lo verifica.
 */
import { describe, expect, it } from "vitest";
import { renderRichText } from "@/components/editor/render";
import { ALIGNMENTS, alignClass, applyToEveryType } from "@/components/editor/text-align";

/** Documento de un párrafo con la alineación dada. */
const parrafo = (align?: string) => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      ...(align ? { attrs: { align } } : {}),
      content: [{ type: "text", text: "Texto" }],
    },
  ],
});

/** Documento con una imagen con la alineación dada. */
const imagen = (align?: string, width?: number) => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "image", attrs: { src: "/api/uploads/evaluations/i1/a.jpg", align, width } },
      ],
    },
  ],
});

describe("alignClass", () => {
  it("da una clase por alineación", () => {
    expect(ALIGNMENTS.map(alignClass)).toEqual(["ta-left", "ta-center", "ta-right", "ta-justify"]);
  });
});

describe("alineación en el HTML del servidor", () => {
  it("emite la clase y NUNCA un style (el servidor lo descartaría)", () => {
    for (const align of ["center", "right", "justify"] as const) {
      const html = renderRichText(parrafo(align));
      expect(html).toContain(`class="${alignClass(align)}"`);
      expect(html).not.toContain("style=");
      expect(html).not.toContain("text-align");
    }
  });

  it("`left` no ensucia el marcado: es el valor natural", () => {
    expect(renderRichText(parrafo("left"))).toBe("<p>Texto</p>");
    expect(renderRichText(parrafo())).toBe("<p>Texto</p>");
  });

  it("alinea también las imágenes", () => {
    expect(renderRichText(imagen("center"))).toContain('class="ta-center"');
  });

  it("la alineación convive con el ancho de la imagen", () => {
    // Regresión: ambos atributos escriben en el mismo `renderHTML` mergeado;
    // si uno pisara al otro, el docente perdería uno de los dos ajustes.
    const html = renderRichText(imagen("right", 40));
    expect(html).toContain('class="ta-right"');
    expect(html).toContain('width="40%"');
    expect(html).toContain('data-width="40"');
  });

  it("descarta una alineación desconocida en vez de convertirla en clase", () => {
    // El JSON viene de la BD y podría estar manipulado: un valor arbitrario
    // no debe acabar como clase del documento.
    expect(renderRichText(parrafo("inventada"))).toBe("<p>Texto</p>");
    expect(renderRichText(parrafo("center; color:red"))).toBe("<p>Texto</p>");
  });
});

describe("applyToEveryType", () => {
  it("intenta TODOS los tipos aunque el primero ya funcione", () => {
    // Regresión del bug reportado: la primera versión usaba `types.some()`,
    // que corta en el primer `true`. Como "paragraph" va primero y su
    // updateAttributes siempre devuelve true, nunca se llegaba a "image" y
    // las imágenes no se alineaban aunque el texto sí.
    const intentados: string[] = [];
    const ok = applyToEveryType(["paragraph", "heading", "image"], (t) => {
      intentados.push(t);
      return t === "paragraph";
    });
    expect(intentados).toEqual(["paragraph", "heading", "image"]);
    expect(ok).toBe(true);
  });

  it("devuelve true si funcionó alguno, aunque no sea el primero", () => {
    expect(applyToEveryType(["a", "b"], (t) => t === "b")).toBe(true);
  });

  it("devuelve false si no funcionó ninguno", () => {
    expect(applyToEveryType(["a", "b"], () => false)).toBe(false);
    expect(applyToEveryType([], () => true)).toBe(false);
  });
});
