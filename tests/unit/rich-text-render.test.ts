/**
 * Tests de `unwrapSingleParagraph`: el helper que permite que el texto de una
 * pregunta u opción quede en la misma línea que su número/letra.
 *
 * El caso peligroso es el de varios párrafos: desenvolver a ciegas juntaría
 * los textos y dejaría un `</p><p>` suelto en medio del marcado.
 */
import { describe, expect, it } from "vitest";
import { renderRichText, unwrapSingleParagraph } from "@/components/editor/render";

/** Documento TipTap de N párrafos de texto plano. */
function doc(...parrafos: string[]) {
  return {
    type: "doc",
    content: parrafos.map((text) => ({ type: "paragraph", content: [{ text, type: "text" }] })),
  };
}

describe("unwrapSingleParagraph", () => {
  it("quita el <p> cuando hay un solo párrafo", () => {
    expect(unwrapSingleParagraph("<p>¿Qué inicia el conocimiento?</p>")).toBe(
      "¿Qué inicia el conocimiento?",
    );
  });

  it("conserva el marcado interno al desenvolver", () => {
    expect(unwrapSingleParagraph("<p>texto con <strong>negrita</strong></p>")).toBe(
      "texto con <strong>negrita</strong>",
    );
  });

  it("NO desenvuelve cuando hay varios párrafos", () => {
    const html = "<p>Primero.</p><p>Segundo.</p>";
    expect(unwrapSingleParagraph(html)).toBe(html);
  });

  it("NO desenvuelve un <p> con otro <p> anidado dentro", () => {
    const html = "<p>fuera <p>dentro</p></p>";
    expect(unwrapSingleParagraph(html)).toBe(html);
  });

  it("respeta los atributos del <p> al detectarlo", () => {
    expect(unwrapSingleParagraph('<p class="x">hola</p>')).toBe("hola");
  });

  it("deja intacto el HTML que no empieza por <p>", () => {
    expect(unwrapSingleParagraph("hola<br/>mundo")).toBe("hola<br/>mundo");
    expect(unwrapSingleParagraph("<ul><li>a</li></ul>")).toBe("<ul><li>a</li></ul>");
  });

  it("deja intacto lo que empieza con <p> pero no termina en </p>", () => {
    const html = "<p>uno</p><ul><li>a</li></ul>";
    expect(unwrapSingleParagraph(html)).toBe(html);
  });

  it("tolera el string vacío", () => {
    expect(unwrapSingleParagraph("")).toBe("");
    expect(unwrapSingleParagraph("<p></p>")).toBe("");
  });

  it("encaja con lo que produce renderRichText de verdad", () => {
    // Un párrafo: se desenvuelve → el texto va en línea con "319."
    expect(unwrapSingleParagraph(renderRichText(doc("¿Qué inicia el conocimiento?")))).toBe(
      "¿Qué inicia el conocimiento?",
    );
    // Dos párrafos: intacto, con los <p> que separan visualmente.
    const dos = renderRichText(doc("Primero.", "Segundo."));
    expect(unwrapSingleParagraph(dos)).toBe(dos);
    expect(unwrapSingleParagraph(dos)).toContain("</p><p>");
  });
});

describe("renderRichText con listas", () => {
  /**
   * Las listas deben emitir su propia clase (`rt-list-ordered` /
   * `rt-list-bullet`): el enunciado y las opciones se renderizan con
   * `RichTextInline`, que NO lleva `.prose-eval`, y Tailwind Preflight pone
   * `ol, ul { list-style: none }`. Sin la clase pegada al `<ol>`/`<ul>` los
   * numerales de las listas ordenadas desaparecen en el PDF y en el
   * visualizador.
   */
  const docConLista = (tipo: "orderedList" | "bulletList") => ({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Encuentre el mayor dado los siguientes numerales:" }],
      },
      {
        type: tipo,
        content: ["a", "b"].map((text) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        })),
      },
    ],
  });

  it("la lista ordenada emite la clase rt-list-ordered", () => {
    const html = renderRichText(docConLista("orderedList"));
    expect(html).toContain('<ol class="rt-list-ordered">');
    expect(html).toContain("<li>");
    expect(html).toContain("a");
  });

  it("la lista con viñetas emite la clase rt-list-bullet", () => {
    const html = renderRichText(docConLista("bulletList"));
    expect(html).toContain('<ul class="rt-list-bullet">');
    expect(html).toContain("<li>");
  });

  it("la lista no se desenvuelve: el enunciado conserva el <ol> completo", () => {
    const html = renderRichText(docConLista("orderedList"));
    expect(unwrapSingleParagraph(html)).toBe(html);
  });
});

describe("renderRichText con nodos math", () => {
  it('inlineMath → emite HTML KaTeX dentro de un <span class="math-inline" data-tex>', () => {
    const docWithMath = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "La energía " },
            { type: "inlineMath", attrs: { tex: "E=mc^2" } },
            { type: "text", text: " es famosa." },
          ],
        },
      ],
    };
    const html = renderRichText(docWithMath);
    // KaTeX output incluye el texto original en <span class="katex">…
    expect(html).toContain('class="math-inline"');
    expect(html).toContain('data-tex="E=mc^2"');
    expect(html).toContain("katex");
    // El texto alrededor se preserva dentro del <p>
    expect(html).toContain("La energía");
    expect(html).toContain("es famosa.");
  });

  it('blockMath → emite HTML KaTeX dentro de un <div class="math-block" data-tex>', () => {
    const docWithMath = {
      type: "doc",
      content: [
        { type: "blockMath", attrs: { tex: "x^2 + y^2 = z^2" } },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Es Pitágoras." }],
        },
      ],
    };
    const html = renderRichText(docWithMath);
    expect(html).toContain('class="math-block"');
    expect(html).toContain('data-tex="x^2 + y^2 = z^2"');
    // El paragraph siguiente sigue presente
    expect(html).toContain("Es Pitágoras.");
  });

  it("fórmula con LaTeX inválido no lanza 500 — degrada al literal escapado", () => {
    // KaTeX lanza con ciertos TeX sintácticamente inválidos incluso con
    // throwOnError: false en algunos edge cases. El wrapper del nodo
    // (renderKatex en extensions.ts) tiene un try/catch adicional que
    // devuelve el literal escapado para evitar que el import rompa el
    // PDF. Reproducimos uno de esos casos.
    const docWithBadMath = {
      type: "doc",
      content: [{ type: "inlineMath", attrs: { tex: "\\frac{1}{" } }],
    };
    // Debe devolver HTML (string), no tirar exception
    expect(() => renderRichText(docWithBadMath)).not.toThrow();
    const html = renderRichText(docWithBadMath);
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
  });
});
