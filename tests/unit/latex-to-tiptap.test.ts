import { describe, expect, it } from "vitest";
import { latexTextToTipTapNodes } from "@/modules/question-import/application/latex-to-tiptap";

/**
 * Helper para inspeccionar un array de nodos sin escribir todo el shape a
 * mano en cada `expect`. Acepta arrays de TipTapNode y compara contra
 * `toEqual`. Solo se usa en este test file.
 */
type Node = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  text?: string;
};

describe("latexTextToTipTapNodes", () => {
  it("texto plano sin fórmulas → un único paragraph con todo el texto", () => {
    expect(latexTextToTipTapNodes("Hola mundo")).toEqual<Node[]>([
      {
        type: "paragraph",
        content: [{ type: "text", text: "Hola mundo" }],
      },
    ]);
  });

  it("inline `$x^2$` entre texto → un paragraph con text + inlineMath + text", () => {
    const out = latexTextToTipTapNodes("La ecuación $x^2$ es importante");
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("paragraph");
    expect(out[0]!.content).toEqual<Node[]>([
      { type: "text", text: "La ecuación " },
      { type: "inlineMath", attrs: { tex: "x^2" } },
      { type: "text", text: " es importante" },
    ]);
  });

  it("block `$$...$$` solo → un único nodo blockMath top-level (sin paragraph accesorio)", () => {
    const out = latexTextToTipTapNodes("$$E=mc^2$$");
    expect(out).toEqual<Node[]>([{ type: "blockMath", attrs: { tex: "E=mc^2" } }]);
  });

  it("block al inicio del texto → blockMath + paragraph con el resto", () => {
    const out = latexTextToTipTapNodes("$$x^2 + y^2 = z^2$$ Es el teorema.");
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ type: "blockMath", attrs: { tex: "x^2 + y^2 = z^2" } });
    // El espacio que sigue al `$$...$$` queda DENTRO del paragraph
    // (la profesora controla el espacio manualmente con `\ ` o pegándolo
    // a la fórmula; no lo recortamos). Aquí la fuente era " Es el..."
    // con espacio a la izquierda del primer carácter imprimible.
    expect(out[1]).toMatchObject({
      type: "paragraph",
      content: [{ type: "text", text: " Es el teorema." }],
    });
  });

  it("block al final del texto → paragraph + blockMath", () => {
    const out = latexTextToTipTapNodes("Mira: $$1+1=2$$");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      type: "paragraph",
      content: [{ type: "text", text: "Mira: " }],
    });
    expect(out[1]).toEqual({ type: "blockMath", attrs: { tex: "1+1=2" } });
  });

  it("múltiples blocks consecutivos → blockMath + paragraph + blockMath + paragraph", () => {
    const out = latexTextToTipTapNodes("$$a+b$$ y $$c-d$$ con texto en medio");
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({ type: "blockMath", attrs: { tex: "a+b" } });
    // Paragraph " y "
    expect(out[1]).toMatchObject({
      type: "paragraph",
      content: [{ type: "text", text: " y " }],
    });
    expect(out[2]).toEqual({ type: "blockMath", attrs: { tex: "c-d" } });
    // Paragraph " con texto en medio"
    expect(out[3]).toMatchObject({
      type: "paragraph",
      content: [{ type: "text", text: " con texto en medio" }],
    });
  });

  it("mix inline + block en el mismo texto → mezcla ordenada", () => {
    const out = latexTextToTipTapNodes(
      "Intro $inline$ luego $$bloque1$$ y $otro inline$ final $$bloque2$$ fin",
    );
    // esperado: paragraph(Intro, inlineMath(inline), text(luego)) + blockMath(bloque1)
    //          + paragraph(text(y), inlineMath(otro inline), text(final)) + blockMath(bloque2)
    //          + paragraph(text(fin))
    expect(out).toHaveLength(5);
    expect(out[0]).toMatchObject({
      type: "paragraph",
      content: [
        { type: "text", text: "Intro " },
        { type: "inlineMath", attrs: { tex: "inline" } },
        { type: "text", text: " luego " },
      ],
    });
    expect(out[1]).toEqual({ type: "blockMath", attrs: { tex: "bloque1" } });
    expect(out[2]).toMatchObject({
      type: "paragraph",
      content: [
        { type: "text", text: " y " },
        { type: "inlineMath", attrs: { tex: "otro inline" } },
        { type: "text", text: " final " },
      ],
    });
    expect(out[3]).toEqual({ type: "blockMath", attrs: { tex: "bloque2" } });
    expect(out[4]).toMatchObject({
      type: "paragraph",
      content: [{ type: "text", text: " fin" }],
    });
  });

  it("texto solo whitespace → [] (trim() interno → empty)", () => {
    expect(latexTextToTipTapNodes("   \n  \t  ")).toEqual([]);
  });

  it("texto vacío → [] (los callers eligen si envolver en paragraph vacío)", () => {
    expect(latexTextToTipTapNodes("")).toEqual([]);
  });

  it("texto solo whitespace → [] (trim() interno → empty)", () => {
    expect(latexTextToTipTapNodes("   \n  \t  ")).toEqual([]);
  });

  it("un `$` suelto (sin pareja) → queda como texto literal (no detecta fórmula)", () => {
    // "$2.99 USD" tiene un `$` pero sin cierre → el regex no-greedy no casa.
    // Importante: el docente puede escribir precios sin que se rompa el import.
    const out = latexTextToTipTapNodes("Cuesta $2.99 USD");
    expect(out).toEqual<Node[]>([
      {
        type: "paragraph",
        content: [{ type: "text", text: "Cuesta $2.99 USD" }],
      },
    ]);
  });

  it("fórmula con `<` o `>` dentro → no se detecta (queda literal); misma restricción que applyKatex legacy", () => {
    // El regex prohíbe `$/<>/` dentro del delimitador. Si la profesora escribe
    // "$x < y$" hoy la fórmula NO se renderiza (queda como texto con $ literales);
    // mantenemos el comportamiento idéntico a applyKatex en render.ts.
    const out = latexTextToTipTapNodes("Comparación $x < y$ verdadera");
    expect(out).toEqual<Node[]>([
      {
        type: "paragraph",
        content: [{ type: "text", text: "Comparación $x < y$ verdadera" }],
      },
    ]);
  });

  it("dos inline en el mismo paragraph, separados solo por texto", () => {
    const out = latexTextToTipTapNodes("$a$ y $b$ juntos");
    expect(out).toEqual<Node[]>([
      {
        type: "paragraph",
        content: [
          { type: "inlineMath", attrs: { tex: "a" } },
          { type: "text", text: " y " },
          { type: "inlineMath", attrs: { tex: "b" } },
          { type: "text", text: " juntos" },
        ],
      },
    ]);
  });

  it("fórmula LaTeX compleja con caracteres que NO se confunden con HTML", () => {
    const out = latexTextToTipTapNodes("La derivada $\\frac{d}{dx}x^2 = 2x$ da el resultado");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "paragraph",
      content: [
        { type: "text", text: "La derivada " },
        { type: "inlineMath", attrs: { tex: "\\frac{d}{dx}x^2 = 2x" } },
        { type: "text", text: " da el resultado" },
      ],
    });
  });
});
