import { describe, expect, it } from "vitest";
import { isTipTapEmpty } from "@/components/editor/rich-text-empty";

describe("isTipTapEmpty", () => {
  it("null / undefined → vacío", () => {
    expect(isTipTapEmpty(null)).toBe(true);
    expect(isTipTapEmpty(undefined)).toBe(true);
  });

  it("string vacío o whitespace → vacío", () => {
    expect(isTipTapEmpty("")).toBe(true);
    expect(isTipTapEmpty("   ")).toBe(true);
    expect(isTipTapEmpty("\n\t  ")).toBe(true);
  });

  it("string con texto real → NO vacío", () => {
    expect(isTipTapEmpty("¿Cuál es la respuesta?")).toBe(false);
    expect(isTipTapEmpty("  x  ")).toBe(false);
  });

  it("doc con EMPTY_DOC (un solo párrafo vacío) → vacío", () => {
    expect(isTipTapEmpty({ type: "doc", content: [{ type: "paragraph" }] })).toBe(true);
  });

  it("doc con párrafo con text node vacío → vacío", () => {
    expect(
      isTipTapEmpty({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }],
      }),
    ).toBe(true);
  });

  it("doc con párrafo con text whitespace → vacío", () => {
    expect(
      isTipTapEmpty({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "   \n  " }] }],
      }),
    ).toBe(true);
  });

  it("doc con párrafo con texto real → NO vacío", () => {
    expect(
      isTipTapEmpty({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "¿Cuál es la capital de Francia?" }],
          },
        ],
      }),
    ).toBe(false);
  });

  it("doc con múltiples párrafos donde alguno tiene texto → NO vacío", () => {
    expect(
      isTipTapEmpty({
        type: "doc",
        content: [
          { type: "paragraph" },
          { type: "paragraph", content: [{ type: "text", text: "Hola" }] },
        ],
      }),
    ).toBe(false);
  });

  it("doc con heading o blockquote con texto → NO vacío", () => {
    expect(
      isTipTapEmpty({
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 3 },
            content: [{ type: "text", text: "Título" }],
          },
        ],
      }),
    ).toBe(false);
    expect(
      isTipTapEmpty({
        type: "doc",
        content: [
          {
            type: "blockquote",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Cita textual" }],
              },
            ],
          },
        ],
      }),
    ).toBe(false);
  });

  it("doc con solo imagen (sin caption) → NO vacío", () => {
    // ago 2026: pedido del docente, "permite guardar si hay solo
    // imagenes". Una imagen es contenido renderizable válido aunque no
    // tenga texto acompañante (la impresión la muestra tal cual).
    expect(
      isTipTapEmpty({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "image", attrs: { src: "x" } }] }],
      }),
    ).toBe(false);
  });

  it("doc con imagen a nivel top-level (sin paragraph) → NO vacío", () => {
    expect(
      isTipTapEmpty({
        type: "doc",
        content: [{ type: "image", attrs: { src: "x" } }],
      }),
    ).toBe(false);
  });

  it("doc con solo tabla → NO vacío", () => {
    expect(
      isTipTapEmpty({
        type: "doc",
        content: [{ type: "table", content: [] }],
      }),
    ).toBe(false);
  });

  it("doc con solo blockMath → NO vacío", () => {
    expect(
      isTipTapEmpty({
        type: "doc",
        content: [{ type: "blockMath", attrs: { latex: "x^2" } }],
      }),
    ).toBe(false);
  });

  it("doc con solo heading → NO vacío", () => {
    expect(
      isTipTapEmpty({
        type: "doc",
        content: [{ type: "heading", attrs: { level: 3 } }],
      }),
    ).toBe(false);
  });

  it("objeto sin content ni text → vacío", () => {
    expect(isTipTapEmpty({ type: "paragraph" })).toBe(true);
    expect(isTipTapEmpty({})).toBe(true);
  });

  it("valor primitivo no-objeto → vacío", () => {
    expect(isTipTapEmpty(42)).toBe(true);
    expect(isTipTapEmpty(true)).toBe(true);
  });

  it("string con JSON crudo se trata como texto plano (no se parsea)", () => {
    // El RichTextEditor emite un hidden input con JSON.stringify del doc.
    // El form (`question-form.tsx`) hace JSON.parse antes de llamar al
    // helper; aquí validamos que isTipTapEmpty no asuma parseo implícito.
    // Un string con JSON literal es texto plano para esta función: si
    // tiene contenido no-whitespace, NO está vacío (lo cual es coherente
    // con "siempre parseamos antes").
    expect(isTipTapEmpty('{"type":"doc","content":[{"type":"paragraph"}]}')).toBe(false);
    expect(isTipTapEmpty("")).toBe(true);
  });
});
