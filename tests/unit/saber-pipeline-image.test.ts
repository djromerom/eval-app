import { describe, expect, it } from "vitest";
import { resolveImageId } from "@/lib/saber-extractor/pipeline";
import type { Context, ExtractedQuestion, Figure } from "@/lib/saber-extractor/types";

const fig = (id: string, page = 1): Figure => ({
  id,
  page,
  bbox: [0, 0, 1, 1],
  caption: null,
  file: `${id}.png`,
  source: "embedded",
  verified: "ok",
});

const q = (over: Partial<ExtractedQuestion> = {}): ExtractedQuestion => ({
  number: 1,
  contextTitle: null,
  text: "Enunciado base",
  options: [
    { key: "A", text: "a" },
    { key: "B", text: "b" },
  ],
  competency: null,
  evidence: null,
  imagePlaceholder: null,
  ...over,
});

const ctx = (over: Partial<Context>): Context => ({
  title: null,
  text: "",
  ...over,
});

describe("resolveImageId", () => {
  it("devuelve el id del imagePlaceholder cuando el LLM lo llenó", () => {
    const question = q({ imagePlaceholder: "!!IMAGEN p02-fig1!!" });
    const figures = [fig("p02-fig1"), fig("p02-fig2")];
    expect(resolveImageId(question, undefined, figures)).toBe("p02-fig1");
  });

  it("placeholder gana aunque el contexto tenga su propia figura", () => {
    const question = q({
      imagePlaceholder: "!!IMAGEN p03-fig1!!",
      contextTitle: "Lectura 1",
    });
    const context = ctx({ text: "Lectura con [IMAGEN p03-fig2] adentro." });
    const figures = [fig("p03-fig1"), fig("p03-fig2")];
    expect(resolveImageId(question, context, figures)).toBe("p03-fig1");
  });

  it("cae al contexto compartido cuando el placeholder está vacío", () => {
    const question = q({ contextTitle: "Lectura 1" });
    const context = ctx({ text: "Contexto [IMAGEN p04-fig2] y [IMAGEN p04-fig3]." });
    const figures = [fig("p04-fig2"), fig("p04-fig3")];
    expect(resolveImageId(question, context, figures)).toBe("p04-fig2");
  });

  it("cae al texto de la pregunta cuando no hay placeholder ni contexto (caso reportado)", () => {
    // Caso típico del bug: el LLM detecta la figura, la referencia en q.text,
    // pero olvida llenar imagePlaceholder. Sin este fallback la pregunta
    // queda sin imagen asociada.
    const question = q({
      text: "En el interior del siguiente círculo se muestra un triángulo [IMAGEN p05-fig1].",
    });
    const figures = [fig("p05-fig1")];
    expect(resolveImageId(question, undefined, figures)).toBe("p05-fig1");
  });

  it("usa el texto de la pregunta cuando hay contextTitle pero el contexto NO tiene figura", () => {
    // Pregunta con contexto que NO referencia figuras pero la propia pregunta
    // sí — el contexto no debe enmascarar la figura de la pregunta.
    const question = q({
      contextTitle: "Lectura 1",
      text: "Según el gráfico [IMAGEN p06-fig1], ¿cuál es el valor?",
    });
    const context = ctx({ text: "Lectura sin figuras." });
    const figures = [fig("p06-fig1")];
    expect(resolveImageId(question, context, figures)).toBe("p06-fig1");
  });

  it("devuelve null cuando no hay ni placeholder ni refs en contexto ni en texto", () => {
    const question = q({ text: "Pregunta sin imagen." });
    const figures = [fig("p07-fig1")];
    expect(resolveImageId(question, undefined, figures)).toBeNull();
  });

  it("devuelve null cuando no hay figuras (modo images desactivado)", () => {
    const question = q({
      imagePlaceholder: "!!IMAGEN p08-fig1!!",
      text: "Con [IMAGEN p08-fig1] inline.",
    });
    expect(resolveImageId(question, undefined, null)).toBeNull();
  });

  it("ignora refs no globalizadas en el texto (numeración cruda del LLM)", () => {
    // Después de globalizeFigures todo está en formato p##-fig#; si por
    // algún motivo quedó un "1" suelto, figureIdsInText lo descarta.
    const question = q({ text: "Mira [IMAGEN 1] aquí." });
    const figures = [fig("p09-fig1")];
    expect(resolveImageId(question, undefined, figures)).toBeNull();
  });
});
