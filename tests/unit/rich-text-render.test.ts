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
