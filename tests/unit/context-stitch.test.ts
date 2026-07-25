import { describe, expect, it } from "vitest";
import {
  collectUniqueContexts,
  mergeContextsIntoSectionContent,
  prependContextToBankQuestion,
  stripContextFromQuestions,
} from "@/modules/question-import/application/context-stitch";
import type { ParsedQuestion } from "@/modules/question-import/domain/parsed-question";

const q = (over: Partial<ParsedQuestion> = {}): ParsedQuestion => ({
  sourceNumber: 1,
  text: "¿Cuál es la capital?",
  options: [
    { key: "A", text: "a" },
    { key: "B", text: "b" },
  ],
  correctAnswer: "B",
  competency: null,
  evidence: null,
  contextTitle: null,
  contextText: null,
  image: null,
  warnings: [],
  ...over,
});

describe("collectUniqueContexts", () => {
  it("devuelve vacío si nadie trae contexto", () => {
    expect(collectUniqueContexts([q(), q()])).toEqual([]);
  });

  it("deduplica tras trim y preserva orden de aparición", () => {
    const list = [
      q({ contextText: "Contexto A" }),
      q({ contextText: "  Contexto A  " }), // dup tras trim
      q({ contextText: "Contexto B" }),
      q({ contextText: null }),
      q({ contextText: "   " }), // vacío tras trim
      q({ contextText: "Contexto A" }), // dup
    ];
    expect(collectUniqueContexts(list)).toEqual(["Contexto A", "Contexto B"]);
  });

  it("ignora null y strings vacíos", () => {
    expect(collectUniqueContexts([q({ contextText: null }), q({ contextText: "" })])).toEqual([]);
  });
});

describe("mergeContextsIntoSectionContent", () => {
  it("si no hay contextos, devuelve el section content tal cual", () => {
    const current = { type: "doc", content: [{ type: "paragraph", content: [] }] };
    const merged = mergeContextsIntoSectionContent(current, []);
    expect(merged).toEqual(current);
  });

  it("si la sección está vacía, escribe los contextos como párrafos", () => {
    const empty = { type: "doc", content: [] };
    const merged = mergeContextsIntoSectionContent(empty, ["Contexto A", "Contexto B"]);
    expect(merged.type).toBe("doc");
    expect(merged.content).toHaveLength(2);
    expect(merged.content[0]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "Contexto A" }],
    });
    expect(merged.content[1]!.type).toBe("paragraph");
  });

  it("si la sección YA tiene contenido, inserta un `horizontalRule` antes del primer contexto nuevo", () => {
    const existing = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Texto pre-existente" }] }],
    } as const;
    const merged = mergeContextsIntoSectionContent(existing, ["Nuevo Contexto"]);
    expect(merged.content).toHaveLength(3);
    expect(merged.content[0]).toEqual(existing.content[0]);
    expect((merged.content[1] as { type: string }).type).toBe("horizontalRule");
    expect((merged.content[2] as { type: string }).type).toBe("paragraph");
  });

  it("si recibe un section content malformado, lo trata como vacío", () => {
    const merged = mergeContextsIntoSectionContent(null, ["X"]);
    expect(merged).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "X" }] }],
    });
  });

  it("convierte [TABLA: ...] dentro de cada contexto en un nodo table real", () => {
    const ctx1 = `Antes de la tabla.
[TABLA: Notas
| Materia | Nota |
|---|---|
| Matemáticas | 4.5 |]`;
    const ctx2 = `Otra lectura sin tabla, solo texto.`;

    const merged = mergeContextsIntoSectionContent(null, [ctx1, ctx2]);
    // ctx1 → paragraph + heading(4) + table
    // ctx2 → paragraph
    expect(merged.content).toHaveLength(4);
    expect(merged.content[0]).toMatchObject({ type: "paragraph" });
    expect(merged.content[1]).toMatchObject({
      type: "heading",
      attrs: { level: 4 },
      content: [{ type: "text", text: "Notas" }],
    });
    expect(merged.content[2]).toMatchObject({ type: "table" });
    expect(merged.content[3]).toMatchObject({
      type: "paragraph",
      content: [{ type: "text", text: "Otra lectura sin tabla, solo texto." }],
    });
  });
});

describe("prependContextToBankQuestion", () => {
  it("si no hay contexto, devuelve el text original", () => {
    const text = { type: "doc", content: [{ type: "paragraph", content: [] }] };
    expect(prependContextToBankQuestion(text, null, "  ")).toEqual(text);
  });

  it("ante pone un heading «Contexto» y el párrafo del contexto al text existente", () => {
    const original = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Enunciado" }] }],
    } as const;
    const out = prependContextToBankQuestion(original, null, "Texto del contexto");
    expect(out.content).toHaveLength(3);
    expect(out.content[0]).toEqual({
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text: "Contexto" }],
    });
    expect(out.content[1]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "Texto del contexto" }],
    });
    expect(out.content[2]).toEqual(original.content[0]);
  });

  it("usa el contextTitle si viene (en lugar del genérico «Contexto»)", () => {
    const out = prependContextToBankQuestion(
      { type: "doc", content: [] },
      "Texto introductorio",
      "Cuerpo",
    );
    expect(out.content[0]).toEqual({
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text: "Texto introductorio" }],
    });
  });

  it("convierte [TABLA: ...] dentro del contexto en un nodo table real", () => {
    const contextText = `Lea las descripciones.
[TABLA: In the kitchen | Descripciones | Palabras |
|---|---|---|
| Some are round. | A. bowls |]`;
    const out = prependContextToBankQuestion(
      {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "¿Cuál escoge?" }] }],
      },
      null,
      contextText,
    );

    // heading(3) "Contexto" + paragraph("Lea las descripciones.") +
    // heading(4) "In the kitchen" + table + paragraph pregunta
    expect(out.content).toHaveLength(5);
    expect(out.content[0]).toMatchObject({ type: "heading", attrs: { level: 3 } });
    expect(out.content[1]).toMatchObject({ type: "paragraph" });
    expect(out.content[2]).toMatchObject({
      type: "heading",
      attrs: { level: 4 },
      content: [{ type: "text", text: "In the kitchen" }],
    });
    expect(out.content[3]).toMatchObject({ type: "table" });
    // La pregunta original queda al final
    expect(out.content[4]).toMatchObject({
      type: "paragraph",
      content: [{ type: "text", text: "¿Cuál escoge?" }],
    });
  });

  it("contexto sin tablas sigue produciendo un único paragraph (compat)", () => {
    // Garantiza que el cambio es retro-compatible: textos planos
    // siguen generando el mismo shape `[header, paragraph, ...]`.
    const out = prependContextToBankQuestion(
      { type: "doc", content: [] },
      null,
      "Solo texto, sin tablas.",
    );
    expect(out.content).toHaveLength(2);
    expect(out.content[1]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "Solo texto, sin tablas." }],
    });
  });
});

describe("stripContextFromQuestions", () => {
  it("devuelve preguntas con contextTitle/contextText nulos", () => {
    const result = stripContextFromQuestions([
      q({ contextTitle: "x", contextText: "y" }),
      q({ contextText: "z" }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]!.contextTitle).toBeNull();
    expect(result[0]!.contextText).toBeNull();
    expect(result[1]!.contextText).toBeNull();
  });

  it("no muta el array original", () => {
    const original = q({ contextText: "y" });
    const result = stripContextFromQuestions([original]);
    expect(original.contextText).toBe("y");
    expect(result[0]!.contextText).toBeNull();
  });
});
