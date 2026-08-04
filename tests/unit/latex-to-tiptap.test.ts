import { describe, expect, it } from "vitest";
import {
  applyPostParseHeuristics,
  latexTextToTipTapNodes,
  type TipTapNode,
} from "@/modules/question-import/application/latex-to-tiptap";

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

  // ---------- HEURÍSTICA POST-PARSE: pseudo-notación [expr]^N ----------

  it("enunciado de la profesora con corchetes literales + ^N → inlineMath + texto", () => {
    // Caso real que motivó el heurístico: la IA devolvió el enunciado como
    // texto plano. Sin el heurístico, esto queda como un único text node
    // y la profesora ve "[10 + 6 - 4(8/2)]^0 + 5" sin KaTeX.
    const out = latexTextToTipTapNodes("El resultado de la expresión [10 + 6 - 4(8/2)]^0 + 5, es:");
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("paragraph");
    expect(out[0]!.content).toEqual<Node[]>([
      { type: "text", text: "El resultado de la expresión " },
      { type: "inlineMath", attrs: { tex: "[10 + 6 - 4(8/2)]^{0}" } },
      { type: "text", text: " + 5, es:" },
    ]);
  });

  it("[x + y]^2 → un único inlineMath con el LaTeX corregido", () => {
    const out = latexTextToTipTapNodes("Calcula [x + y]^2");
    expect(out).toHaveLength(1);
    expect(out[0]!.content).toEqual<Node[]>([
      { type: "text", text: "Calcula " },
      { type: "inlineMath", attrs: { tex: "[x + y]^{2}" } },
    ]);
  });

  it("[abc]^3 SIN operador dentro → queda como texto literal", () => {
    // Sin operador dentro, NO es una fórmula — es prosa. El heurístico
    // exige al menos un operador (+ - * / = < >) para aceptar el match.
    const out = latexTextToTipTapNodes("Mira [abc]^3 por favor");
    expect(out).toEqual<Node[]>([
      {
        type: "paragraph",
        content: [{ type: "text", text: "Mira [abc]^3 por favor" }],
      },
    ]);
  });

  it("[1]^5 sin operador dentro → queda como texto literal (numeral sin operador)", () => {
    // Caso típico de "[1] ver página 2": numeral entre corchetes sin
    // operador. NO debe convertirse en fórmula.
    const out = latexTextToTipTapNodes("Item [1]^5 del listado");
    expect(out).toEqual<Node[]>([
      {
        type: "paragraph",
        content: [{ type: "text", text: "Item [1]^5 del listado" }],
      },
    ]);
  });

  it("texto sin corchetes ni ^ → queda intacto (no regresión)", () => {
    const out = latexTextToTipTapNodes("Hola mundo, sin fórmulas aquí.");
    expect(out).toEqual<Node[]>([
      {
        type: "paragraph",
        content: [{ type: "text", text: "Hola mundo, sin fórmulas aquí." }],
      },
    ]);
  });

  it("precio con $ suelto NO se toca (red de seguridad legacy)", () => {
    // El regex INLINE_MATH_RE exige pareja balanceada: "$2.99 USD" tiene
    // UN solo $ literal → no casa. La heurística nueva tampoco toca este
    // caso (no hay corchetes ni ^). El precio queda intacto.
    const out = latexTextToTipTapNodes("Cuesta $2.99 USD");
    expect(out).toEqual<Node[]>([
      {
        type: "paragraph",
        content: [{ type: "text", text: "Cuesta $2.99 USD" }],
      },
    ]);
  });

  it("mix: $inline$ de LaTeX + [a+b]^2 de heurística → ambos conviven en el paragraph", () => {
    const out = latexTextToTipTapNodes("Si $x$ y [a+b]^2 juntos");
    expect(out).toHaveLength(1);
    expect(out[0]!.content).toEqual<Node[]>([
      { type: "text", text: "Si " },
      { type: "inlineMath", attrs: { tex: "x" } },
      { type: "text", text: " y " },
      { type: "inlineMath", attrs: { tex: "[a+b]^{2}" } },
      { type: "text", text: " juntos" },
    ]);
  });

  it("block $$...$$ → la heurística NO entra (sale como blockMath antes)", () => {
    // El bloque `$$...$$` se extrae en la pasada 1 como blockMath top-level.
    // El heurístico solo recorre nodos paragraph, así que un blockMath con
    // `[a+b]^2` dentro NO se toca (su `tex` ya es lo que la IA escribió).
    const out = latexTextToTipTapNodes("$$[a+b]^2$$ fin");
    expect(out).toEqual<Node[]>([
      { type: "blockMath", attrs: { tex: "[a+b]^2" } },
      {
        type: "paragraph",
        content: [{ type: "text", text: " fin" }],
      },
    ]);
  });

  it("[a<b]^3 NO se detecta — < prohibido dentro del delimitador (igual que applyKatex)", () => {
    // Misma restricción que el regex legacy: < y > rompen el HTML al
    // serializar, así que el heurístico los prohíbe también.
    const out = latexTextToTipTapNodes("Si [a<b]^3 entonces");
    expect(out).toEqual<Node[]>([
      {
        type: "paragraph",
        content: [{ type: "text", text: "Si [a<b]^3 entonces" }],
      },
    ]);
  });

  it("varios matches en el mismo texto → cada uno se convierte a inlineMath", () => {
    const out = latexTextToTipTapNodes("Entre [a+b]^2 y [c-d]^3 hay más");
    expect(out).toHaveLength(1);
    expect(out[0]!.content).toEqual<Node[]>([
      { type: "text", text: "Entre " },
      { type: "inlineMath", attrs: { tex: "[a+b]^{2}" } },
      { type: "text", text: " y " },
      { type: "inlineMath", attrs: { tex: "[c-d]^{3}" } },
      { type: "text", text: " hay más" },
    ]);
  });
});

// ============================================================
// applyPostParseHeuristics (verificación aislada del helper)
// ============================================================

describe("applyPostParseHeuristics", () => {
  it("array vacío → array vacío", () => {
    expect(applyPostParseHeuristics([])).toEqual([]);
  });

  it("blockMath → bloque NO se toca (solo paragraph.content se reescribe)", () => {
    const nodes: TipTapNode[] = [{ type: "blockMath", attrs: { tex: "[a+b]^2" } }];
    expect(applyPostParseHeuristics(nodes)).toEqual(nodes);
  });

  it("paragraph sin text nodes → queda intacto", () => {
    const nodes: TipTapNode[] = [
      { type: "paragraph", content: [{ type: "inlineMath", attrs: { tex: "x" } }] },
    ];
    expect(applyPostParseHeuristics(nodes)).toEqual(nodes);
  });

  it("paragraph con text sin matches → devuelve nodos equivalentes (mismo text)", () => {
    const nodes: TipTapNode[] = [
      { type: "paragraph", content: [{ type: "text", text: "Hola mundo" }] },
    ];
    expect(applyPostParseHeuristics(nodes)).toEqual(nodes);
  });

  it("paragraph con text que matchea → reescribe el content", () => {
    const nodes: TipTapNode[] = [
      { type: "paragraph", content: [{ type: "text", text: "Antes [a+b]^2 después" }] },
    ];
    const out = applyPostParseHeuristics(nodes);
    expect(out).toEqual<TipTapNode[]>([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Antes " },
          { type: "inlineMath", attrs: { tex: "[a+b]^{2}" } },
          { type: "text", text: " después" },
        ],
      },
    ]);
  });
});
