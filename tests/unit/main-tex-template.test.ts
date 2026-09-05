/**
 * Tests del generador de `main.tex` (L5 — sep 2026).
 * ===================================================
 *
 * Verifica:
 *   • Paquetes requeridos presentes (inputenc, fontenc, babel, etc.).
 *   • `\input{eval-N.tex}` por cada evaluation.
 *   • Título escapado.
 *   • Date default a `\today`.
 *   • Date custom se respeta.
 *   • Lista vacía de inputs no rompe (main.tex sin `\input`).
 */
import { describe, expect, it } from "vitest";
import { buildMainTex } from "@/modules/latex-export/domain/main-tex-template";

describe("buildMainTex", () => {
  it("incluye el preamble con paquetes requeridos", () => {
    const out = buildMainTex({
      bundleName: "Cuadernillo 1",
      inputFiles: ["eval-1.tex"],
    });
    expect(out).toContain("\\documentclass[11pt]{article}");
    expect(out).toContain("\\usepackage[utf8]{inputenc}");
    expect(out).toContain("\\usepackage[T1]{fontenc}");
    expect(out).toContain("\\usepackage[spanish]{babel}");
    expect(out).toContain("\\usepackage{graphicx}");
    expect(out).toContain("\\usepackage{enumitem}");
    expect(out).toContain("\\usepackage{tabularx}");
    expect(out).toContain("\\usepackage{hyperref}");
  });

  it("incluye \\setlist para enumerate e itemize", () => {
    const out = buildMainTex({ bundleName: "X", inputFiles: [] });
    expect(out).toContain("\\setlist[enumerate]{label=\\textbf{\\arabic*.}, leftmargin=*}");
    expect(out).toContain("\\setlist[itemize]{label=\\textbullet, leftmargin=*}");
  });

  it("\\input{eval-N.tex} por cada input file en orden", () => {
    const out = buildMainTex({
      bundleName: "X",
      inputFiles: ["eval-1.tex", "eval-2.tex", "eval-3.tex"],
    });
    expect(out).toContain("\\input{eval-1.tex}");
    expect(out).toContain("\\input{eval-2.tex}");
    expect(out).toContain("\\input{eval-3.tex}");

    // Orden: eval-1 antes que eval-2 antes que eval-3.
    const idx1 = out.indexOf("\\input{eval-1.tex}");
    const idx2 = out.indexOf("\\input{eval-2.tex}");
    const idx3 = out.indexOf("\\input{eval-3.tex}");
    expect(idx1).toBeLessThan(idx2);
    expect(idx2).toBeLessThan(idx3);
  });

  it("\\title{...} contiene el bundle name (escapado)", () => {
    const out = buildMainTex({
      bundleName: "Cuadernillo 50% & $x$",
      inputFiles: ["eval-1.tex"],
    });
    expect(out).toContain("\\title{Cuadernillo 50\\% \\& \\$x\\$");
  });

  it("\\date por defecto usa \\today", () => {
    const out = buildMainTex({ bundleName: "X", inputFiles: [] });
    expect(out).toContain("\\date{\\today}");
  });

  it("\\date custom se respeta (escapado)", () => {
    const out = buildMainTex({
      bundleName: "X",
      inputFiles: [],
      date: "4 sep 2026",
    });
    expect(out).toContain("\\date{4 sep 2026}");
  });

  it("lista de inputs vacía NO rompe (no \\input)", () => {
    const out = buildMainTex({ bundleName: "X", inputFiles: [] });
    expect(out).not.toContain("\\input{");
    // Pero el documento SÍ se abre y cierra correctamente.
    expect(out).toContain("\\begin{document}");
    expect(out).toContain("\\end{document}");
  });

  it("estructura del documento: preamble, begin, maketitle, inputs, end", () => {
    const out = buildMainTex({ bundleName: "X", inputFiles: ["eval-1.tex"] });
    const docClass = out.indexOf("\\documentclass");
    const beginDoc = out.indexOf("\\begin{document}");
    const maketitle = out.indexOf("\\maketitle");
    const input = out.indexOf("\\input{eval-1.tex}");
    const endDoc = out.indexOf("\\end{document}");
    expect(docClass).toBeLessThan(beginDoc);
    expect(beginDoc).toBeLessThan(maketitle);
    expect(maketitle).toBeLessThan(input);
    expect(input).toBeLessThan(endDoc);
  });

  it("hyperref va al final del preamble (best practice)", () => {
    const out = buildMainTex({ bundleName: "X", inputFiles: [] });
    const hyperref = out.indexOf("\\usepackage{hyperref}");
    const enumitem = out.indexOf("\\usepackage{enumitem}");
    expect(enumitem).toBeLessThan(hyperref);
  });

  it("preserva caracteres españoles en el título (no escapa ñ, tildes, ¿)", () => {
    const out = buildMainTex({
      bundleName: "Evaluación de Álgebra — 10°",
      inputFiles: [],
    });
    // Caracteres UTF-8 que NO requieren escape (soportados por inputenc{utf8}):
    expect(out).toContain("Álgebra");
    expect(out).toContain("Evaluación");
    expect(out).toContain("—"); // em dash pasa literal
  });
});
