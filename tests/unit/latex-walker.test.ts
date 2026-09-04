/**
 * Tests del walker TipTap → LaTeX (L3 — sep 2026).
 * ==================================================
 *
 * Cubre cada tipo de nodo con el input más simple posible:
 *   • doc, paragraph, heading, text + marks (bold/italic/code/underline/strike)
 *   • inlineMath, blockMath
 *   • image (inline vs block, con/sin width, external skip)
 *   • bulletList, orderedList (con/sin `start`)
 *   • hardBreak (dentro vs fuera de celda tabularx)
 *   • textAlign (center, right)
 *   • Unknown nodes (defensivo, NUNCA throw)
 *   • Escape correcto del texto (integración con latex-escape)
 */
import { describe, expect, it } from "vitest";
import {
  tiptapToLatex,
  type ImageResolution,
  type WalkerContext,
} from "@/modules/latex-export/domain/latex-walker";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const passthrough: WalkerContext = {
  images: [],
  insideTableCell: false,
  depth: 0,
  resolveImage: (_src) => ({ kind: "inline", filename: "img-1.png" }),
};

const skipper: WalkerContext = {
  images: [],
  insideTableCell: false,
  depth: 0,
  resolveImage: (_src) => ({ kind: "skip", reason: "external" }),
};

function doc(...content: unknown[]) {
  return { type: "doc", content };
}

function p(...content: unknown[]) {
  return { type: "paragraph", content };
}

function t(text: string, marks?: Array<{ type: string }>) {
  return { type: "text", text, ...(marks ? { marks } : {}) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("tiptapToLatex", () => {
  // ========================================================================
  // doc + paragraph
  // ========================================================================

  it("doc vacío devuelve string vacío", () => {
    expect(tiptapToLatex(doc(p()), passthrough)).toBe("");
  });

  it("paragraph simple con text → solo el texto escapado", () => {
    expect(tiptapToLatex(doc(p(t("Hola mundo"))), passthrough)).toBe("Hola mundo");
  });

  it("dos párrafos se separan con \\n\\n", () => {
    const out = tiptapToLatex(doc(p(t("A")), p(t("B"))), passthrough);
    expect(out).toBe("A\n\nB");
  });

  it("paragraph con texto escapado (integración latex-escape)", () => {
    expect(tiptapToLatex(doc(p(t("50% & $x$"))), passthrough)).toBe("50\\% \\& \\$x\\$");
  });

  it("paragraph vacío se omite del output", () => {
    expect(tiptapToLatex(doc(p(), p(t("Hola"))), passthrough)).toBe("Hola");
  });

  // ========================================================================
  // Heading
  // ========================================================================

  it.each([
    [1, "section"],
    [2, "subsection"],
    [3, "subsubsection"],
  ])("heading level %i → \\%s*{...}", (level, cmd) => {
    const out = tiptapToLatex(
      doc({ type: "heading", attrs: { level }, content: [t("Mi título")] }),
      passthrough,
    );
    expect(out).toBe(`\\${cmd}*{Mi título}`);
  });

  it("heading vacío se omite", () => {
    const out = tiptapToLatex(
      doc({ type: "heading", attrs: { level: 2 }, content: [] }),
      passthrough,
    );
    expect(out).toBe("");
  });

  // ========================================================================
  // Math
  // ========================================================================

  it("inlineMath → $tex$ (sin escape)", () => {
    const out = tiptapToLatex(doc(p({ type: "inlineMath", attrs: { tex: "x^2" } })), passthrough);
    expect(out).toBe("$x^2$");
  });

  it("inlineMath con caracteres especiales en tex NO se escapan", () => {
    // CRÍTICO: `tex` ya es LaTeX crudo de KaTeX; escaparlo lo rompería.
    const out = tiptapToLatex(
      doc(p({ type: "inlineMath", attrs: { tex: "\\frac{a}{b}" } })),
      passthrough,
    );
    expect(out).toBe("$\\frac{a}{b}$");
  });

  it("blockMath → \\[tex\\]", () => {
    const out = tiptapToLatex(
      doc({ type: "blockMath", attrs: { tex: "\\sum_{i=1}^n i" } }),
      passthrough,
    );
    expect(out).toBe("\\[\\sum_{i=1}^n i\\]");
  });

  it("texto + inlineMath + texto en el mismo párrafo", () => {
    const out = tiptapToLatex(
      doc(p(t("Si "), { type: "inlineMath", attrs: { tex: "x" } }, t(" entonces..."))),
      passthrough,
    );
    expect(out).toBe("Si $x$ entonces...");
  });

  // ========================================================================
  // Marks
  // ========================================================================

  it.each([
    ["bold", "\\textbf{Hola}"],
    ["italic", "\\textit{Hola}"],
    ["code", "\\texttt{Hola}"],
    ["underline", "\\underline{Hola}"],
    ["strike", "\\sout{Hola}"],
  ])("mark %s → wrap correcto", (mark, expected) => {
    const out = tiptapToLatex(doc(p(t("Hola", [{ type: mark }]))), passthrough);
    expect(out).toBe(expected);
  });

  it("bold + italic anidados: bold por fuera", () => {
    const out = tiptapToLatex(
      doc(p(t("Hola", [{ type: "bold" }, { type: "italic" }]))),
      passthrough,
    );
    expect(out).toBe("\\textbf{\\textit{Hola}}");
  });

  // ========================================================================
  // Listas
  // ========================================================================

  it("bulletList simple", () => {
    const out = tiptapToLatex(
      doc({
        type: "bulletList",
        content: [
          { type: "listItem", content: [p(t("uno"))] },
          { type: "listItem", content: [p(t("dos"))] },
        ],
      }),
      passthrough,
    );
    expect(out).toBe("\\begin{itemize}\n  \\item uno\n  \\item dos\n\\end{itemize}");
  });

  it("orderedList simple", () => {
    const out = tiptapToLatex(
      doc({
        type: "orderedList",
        content: [
          { type: "listItem", content: [p(t("A"))] },
          { type: "listItem", content: [p(t("B"))] },
        ],
      }),
      passthrough,
    );
    expect(out).toBe("\\begin{enumerate}\n  \\item A\n  \\item B\n\\end{enumerate}");
  });

  it("orderedList con `start` > 1 → [start=N]", () => {
    const out = tiptapToLatex(
      doc({
        type: "orderedList",
        attrs: { start: 5 },
        content: [{ type: "listItem", content: [p(t("Quinto"))] }],
      }),
      passthrough,
    );
    expect(out).toContain("[start=5]");
  });

  it("orderedList con start=1 (default) NO agrega [start=1]", () => {
    const out = tiptapToLatex(
      doc({
        type: "orderedList",
        attrs: { start: 1 },
        content: [{ type: "listItem", content: [p(t("A"))] }],
      }),
      passthrough,
    );
    expect(out).not.toContain("[start=1]");
  });

  it("listItem vacío se omite", () => {
    const out = tiptapToLatex(
      doc({
        type: "bulletList",
        content: [
          { type: "listItem", content: [] },
          { type: "listItem", content: [p(t("valido"))] },
        ],
      }),
      passthrough,
    );
    expect(out).toContain("\\item valido");
    expect(out).not.toContain("\\item \n");
  });

  // ========================================================================
  // Hard break
  // ========================================================================

  it("hardBreak fuera de celda → \\\\", () => {
    const out = tiptapToLatex(doc(p(t("línea1"), { type: "hardBreak" }, t("línea2"))), passthrough);
    expect(out).toBe("línea1\\\\\nlínea2");
  });

  it("hardBreak dentro de celda tabularx → \\newline", () => {
    const cellCtx = { ...passthrough, insideTableCell: true };
    const out = tiptapToLatex(doc(p(t("a"), { type: "hardBreak" }, t("b"))), cellCtx);
    expect(out).toBe("a\\newline\nb");
  });

  // ========================================================================
  // Image
  // ========================================================================

  it("image inline con width=60% → \\includegraphics[width=0.6\\linewidth]{...}", () => {
    const out = tiptapToLatex(
      doc(
        p({
          type: "image",
          attrs: { src: "/api/uploads/x.png", width: 60 },
        }),
      ),
      { ...passthrough, resolveImage: () => ({ kind: "inline", filename: "img-1.png" }) },
    );
    expect(out).toBe("\\includegraphics[width=0.6\\linewidth]{images/img-1.png}");
  });

  it("image sin width → default 0.6\\linewidth", () => {
    const out = tiptapToLatex(
      doc(
        p({
          type: "image",
          attrs: { src: "/api/uploads/y.png" },
        }),
      ),
      passthrough,
    );
    expect(out).toContain("[width=0.6\\linewidth]");
  });

  it("image con width=100 → width=1\\linewidth", () => {
    const out = tiptapToLatex(
      doc(
        p({
          type: "image",
          attrs: { src: "/api/uploads/z.png", width: 100 },
        }),
      ),
      passthrough,
    );
    expect(out).toContain("[width=1\\linewidth]");
  });

  it("image externa (resolver=skip) → comentario", () => {
    const out = tiptapToLatex(
      doc(p({ type: "image", attrs: { src: "https://cdn.example.com/img.png" } })),
      skipper,
    );
    expect(out).toContain("% [imagen externa omitida:");
  });

  it("image sin src → comentario de aviso", () => {
    const out = tiptapToLatex(doc(p({ type: "image", attrs: {} })), passthrough);
    expect(out).toBe("% [imagen sin src]");
  });

  it("image con alt se incluye como segundo arg opcional", () => {
    const out = tiptapToLatex(
      doc(
        p({
          type: "image",
          attrs: { src: "/api/uploads/x.png", width: 50, alt: "Logo institucional" },
        }),
      ),
      passthrough,
    );
    expect(out).toContain(",Logo institucional]");
  });

  // ========================================================================
  // textAlign
  // ========================================================================

  it("paragraph con textAlign=center → \\begin{center}...\\end{center}", () => {
    const out = tiptapToLatex(
      doc({ type: "paragraph", attrs: { align: "center" }, content: [t("Centrado")] }),
      passthrough,
    );
    expect(out).toBe("\\begin{center}\nCentrado\n\\end{center}");
  });

  it("paragraph con textAlign=right → \\begin{flushright}", () => {
    const out = tiptapToLatex(
      doc({ type: "paragraph", attrs: { align: "right" }, content: [t("Derecha")] }),
      passthrough,
    );
    expect(out).toBe("\\begin{flushright}\nDerecha\n\\end{flushright}");
  });

  // ========================================================================
  // Nodos desconocidos — defensivo, NUNCA throw
  // ========================================================================

  it("nodo block desconocido → comentario UNHANDLED, no throw", () => {
    const out = tiptapToLatex(doc({ type: "weirdBlockNode", attrs: {}, content: [] }), passthrough);
    expect(out).toContain("% UNHANDLED block node: weirdBlockNode");
  });

  it("nodo inline desconocido → comentario UNHANDLED", () => {
    const out = tiptapToLatex(doc(p({ type: "weirdInlineNode" })), passthrough);
    expect(out).toContain("% UNHANDLED inline node: weirdInlineNode");
  });

  it("doc no-objeto o null → string vacío, no throw", () => {
    expect(tiptapToLatex(null, passthrough)).toBe("");
    expect(tiptapToLatex("string", passthrough)).toBe("");
    expect(tiptapToLatex({}, passthrough)).toBe("");
  });

  // ========================================================================
  // Escape correcto de texto (regresión integrada con latex-escape)
  // ========================================================================

  it("texto con backslash literal → \\char92{}", () => {
    expect(tiptapToLatex(doc(p(t("a\\b"))), passthrough)).toBe("a\\char92{}b");
  });

  it("texto con todos los 10 chars especiales", () => {
    expect(tiptapToLatex(doc(p(t("a{b}c$d#e&f_g~h^i%j<k>l"))), passthrough)).toBe(
      "a\\{b\\}c\\$d\\#e\\&f\\_g\\textasciitilde{}h\\textasciicircum{}i\\%j\\textless{}k\\textgreater{}l",
    );
  });
});
