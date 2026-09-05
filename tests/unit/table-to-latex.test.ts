/**
 * Tests del conversor TipTap → LaTeX tabularx (L4 — sep 2026).
 * ==============================================================
 *
 * Cubre:
 *   • Tabla básica 2x3 con header.
 *   • Column spec: ratios explícitos cuando hay colwidth uniforme.
 *   • Column spec: fallback a `XXXX` cuando no hay colwidth.
 *   • Header row en bold (`\textbf`).
 *   • Empty cell → `~`.
 *   • hardBreak dentro de celda → `\newline` (no `\\`).
 *   • Tabla vacía → string vacío.
 *   • Row con menos cells que colCount → padded con `~`.
 */
import { describe, expect, it } from "vitest";
import { tiptapTableToLatex } from "@/modules/latex-export/domain/table-to-latex";
import type { TipTapNode, WalkerContext } from "@/modules/latex-export/domain/latex-walker";

const passthrough: WalkerContext = {
  images: [],
  insideTableCell: false,
  depth: 0,
  resolveImage: (_src: string) => ({ kind: "inline" as const, filename: "img-1.png" }),
};

function cell(text: string, colwidth?: number[]): TipTapNode {
  return {
    type: "tableCell",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    ...(colwidth ? { attrs: { colwidth } } : {}),
  };
}

function header(text: string, colwidth?: number[]): TipTapNode {
  return {
    type: "tableHeader",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    ...(colwidth ? { attrs: { colwidth } } : {}),
  };
}

function row(...cells: TipTapNode[]): TipTapNode {
  return { type: "tableRow", content: cells };
}

function table(...rows: TipTapNode[]): TipTapNode {
  return { type: "table", content: rows };
}

describe("tiptapTableToLatex", () => {
  it("tabla vacía devuelve string vacío", () => {
    expect(tiptapTableToLatex(table(), passthrough)).toBe("");
  });

  it("tabla 2x3 con header produce tabularx correcto", () => {
    const t = table(
      row(header("A"), header("B"), header("C")),
      row(cell("1"), cell("2"), cell("3")),
    );
    const out = tiptapTableToLatex(t, passthrough);
    expect(out).toContain("\\begin{tabularx}{\\linewidth}");
    expect(out).toContain("\\textbf{A}");
    expect(out).toContain("\\textbf{B}");
    expect(out).toContain("\\textbf{C}");
    expect(out).toContain("1 & 2 & 3");
    expect(out).toContain("\\end{tabularx}");
  });

  it("column spec fallback a XXXX cuando no hay colwidth", () => {
    const t = table(
      row(header("A"), header("B"), header("C"), header("D")),
      row(cell("1"), cell("2"), cell("3"), cell("4")),
    );
    const out = tiptapTableToLatex(t, passthrough);
    // Sin colwidth → spec "XXXX" (4 cols X iguales).
    expect(out).toContain("{XXXX}");
  });

  it("column spec con colwidth uniforme → ratios", () => {
    const t = table(
      row(header("A", [100]), header("B", [100]), header("C", [200])),
      row(cell("1", [100]), cell("2", [100]), cell("3", [200])),
    );
    const out = tiptapTableToLatex(t, passthrough);
    // ratios: 0.25, 0.25, 0.5 → cols X o {0.25\linewidth} etc.
    expect(out).toMatch(/\{0\.25\\linewidth\}.*\{0\.25\\linewidth\}.*\{0\.50\\linewidth\}/);
  });

  it("column spec con colwidth parcial (algunos null) → fallback parcial", () => {
    const t = table(
      row(header("A", [100]), header("B"), header("C", [100])),
      row(cell("1", [100]), cell("2"), cell("3", [100])),
    );
    const out = tiptapTableToLatex(t, passthrough);
    // Algunos cells sin width → caen a `X` simple.
    expect(out).toContain("X");
  });

  it("empty cell → ~ (LaTeX idiom)", () => {
    const t = table(row(header("A"), header("B")), row(cell(""), cell("valor")));
    const out = tiptapTableToLatex(t, passthrough);
    expect(out).toMatch(/~ & valor/);
  });

  it("row con menos cells que colCount → padded con ~", () => {
    const t = table(row(header("A"), header("B"), header("C")), row(cell("solo-una")));
    const out = tiptapTableToLatex(t, passthrough);
    expect(out).toContain("solo-una & ~ & ~");
  });

  it("hardBreak dentro de celda → \\newline (no \\\\)", () => {
    const t = table(
      row(header("Col")),
      row({
        type: "tableCell",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "línea1" },
              { type: "hardBreak" },
              { type: "text", text: "línea2" },
            ],
          },
        ],
      }),
    );
    const out = tiptapTableToLatex(t, passthrough);
    expect(out).toContain("\\newline");
    // No debe haber `\\\\` adentro de la celda (que rompería la fila).
    expect(out).not.toContain("línea1\\\\");
  });

  it("fila que NO es header → cells sin \\textbf", () => {
    const t = table(row(cell("dato")));
    const out = tiptapTableToLatex(t, passthrough);
    expect(out).not.toContain("\\textbf");
    expect(out).toContain("dato");
  });

  it("incluye \\hline repetido", () => {
    const t = table(row(header("A")), row(cell("1")));
    const out = tiptapTableToLatex(t, passthrough);
    // header \\hline row \\hline end → 3 hlines esperados
    const hlineCount = (out.match(/\\hline/g) ?? []).length;
    expect(hlineCount).toBe(3);
  });

  it("escape correcto del texto dentro de celdas", () => {
    const t = table(row(header("Col")), row(cell("50% & $x$")));
    const out = tiptapTableToLatex(t, passthrough);
    expect(out).toContain("50\\% \\& \\$x\\$");
  });
});
