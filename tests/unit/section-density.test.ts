/**
 * Tests de `computeSectionDensity` y `richTextCharCount`.
 *
 * Cubre los tres casos que motivaron la heurística:
 * - Matching A–H (INGLÉS PARTE 1): ~75 chars/ítem → "low".
 * - Pregunta típica con 4 opciones cortas → "low".
 * - Pregunta con párrafo largo → "high".
 * - Pregunta con imagen → "high" (rompe flujo de columna).
 * - Sección vacía o de un solo ítem → "high".
 */
import { describe, expect, it } from "vitest";
import {
  computeSectionDensity,
  resolveSectionDensity,
  richTextCharCount,
} from "@/modules/printing/domain/section-density";
import type {
  EvaluationSection,
  Question,
  QuestionOption,
} from "@/modules/evaluations/domain/evaluation";

/** Documento TipTap de un párrafo de texto. */
const texto = (t: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
});

/** Construye una opción de pregunta con el texto dado. */
const opt = (text: string): QuestionOption => ({ key: "A", text: texto(text) });

/** Construye una pregunta mínima con N opciones de 1 palabra. */
function pregunta(opts: string[], body = "Enunciado"): Question {
  return {
    id: "q",
    number: 1,
    text: texto(body),
    image: null,
    sectionId: "s1",
    options: opts.map((o) => opt(o)),
    correctAnswer: "A",
    justification: null,
    weight: 1,
    soloLevel: null,
    menComponent: null,
    competency: null,
  };
}

/** Construye una sección con N preguntas, cada una con las opciones dadas. */
function seccion(preguntas: Question[]): EvaluationSection {
  return {
    id: "s1",
    title: null,
    content: null,
    order: 0,
    columnLayoutOverride: null,
    questions: preguntas,
  };
}

/** Construye una sección con override explícito. */
function seccionConOverride(
  preguntas: Question[],
  override: "1col" | "2col" | null,
): EvaluationSection {
  return {
    ...seccion(preguntas),
    columnLayoutOverride: override,
  };
}

describe("richTextCharCount", () => {
  it("cuenta texto plano de un párrafo", () => {
    expect(richTextCharCount(texto("Hola mundo"))).toBe(10);
  });

  it("suma varios nodos text en el mismo párrafo", () => {
    expect(
      richTextCharCount({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "foo" },
              { type: "text", text: "bar" },
            ],
          },
        ],
      }),
    ).toBe(6);
  });

  it("recorre párrafos anidados", () => {
    expect(
      richTextCharCount({
        type: "doc",
        content: [
          {
            type: "blockquote",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "anidado" }],
              },
            ],
          },
        ],
      }),
    ).toBe(7);
  });

  it("ignora nodos sin `text` (image, hardBreak, table)", () => {
    expect(
      richTextCharCount({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "image" }] }],
      }),
    ).toBe(0);
  });

  it("tolera null, undefined y string suelto", () => {
    expect(richTextCharCount(null)).toBe(0);
    expect(richTextCharCount(undefined)).toBe(0);
    expect(richTextCharCount("hola")).toBe(4);
  });
});

describe("computeSectionDensity", () => {
  it("sección vacía → high", () => {
    expect(computeSectionDensity(seccion([]))).toBe("high");
  });

  it("sección con un solo ítem → high (no se beneficia de 2-col)", () => {
    expect(computeSectionDensity(seccion([pregunta(["a", "b", "c", "d"])]))).toBe("high");
  });

  it("matching A–H corto → low", () => {
    // Caso real: INGLÉS PARTE 1. 8 opciones de palabras cortas (~5 chars
    // cada una) + enunciado corto (~25 chars) = ~70 chars/ítem.
    const opciones = [
      "bag",
      "bottle",
      "camera",
      "countryside",
      "helmet",
      "map",
      "station",
      "sweater",
    ];
    const preguntas = Array.from({ length: 5 }, () =>
      pregunta(opciones, "You put your clothes in it."),
    );
    expect(computeSectionDensity(seccion(preguntas))).toBe("low");
  });

  it("preguntas típicas con 4 opciones cortas → low", () => {
    // 9 chars de enunciado + 4 opciones de 1 char = 13 chars/ítem.
    const preguntas = Array.from({ length: 5 }, () => pregunta(["a", "b", "c", "d"], "Enunciado"));
    expect(computeSectionDensity(seccion(preguntas))).toBe("low");
  });

  it("preguntas con párrafo largo → high", () => {
    // Enunciado de 250 chars + 4 opciones de 1 char = ~254 chars/ítem > 150.
    const cuerpoLargo =
      "En el contexto histórico latinoamericano del siglo XIX las ideas de la ilustración europea influyeron significativamente en los movimientos independentistas que transformaron el panorama político del continente dando lugar a nuevas naciones";
    const preguntas = Array.from({ length: 5 }, () => pregunta(["a", "b", "c", "d"], cuerpoLargo));
    expect(computeSectionDensity(seccion(preguntas))).toBe("high");
  });

  it("ítem con imagen → high aunque el resto sean cortos", () => {
    const preguntas = Array.from({ length: 5 }, (_, i) =>
      i === 2
        ? { ...pregunta(["a", "b", "c", "d"]), image: "/x.jpg" }
        : pregunta(["a", "b", "c", "d"]),
    );
    expect(computeSectionDensity(seccion(preguntas))).toBe("high");
  });

  it("frontera: avgChars exactamente en el umbral (150) → high", () => {
    // Cada pregunta: cuerpo de X chars + 4 opciones de 3 chars = X+12 chars.
    // promedio = X+12. Para que avg < 150: X < 138. Para avg >= 150: X >= 138.
    const opciones = ["a".repeat(3), "b".repeat(3), "c".repeat(3), "d".repeat(3)]; // 12 chars

    // 140 + 12 = 152 chars/ítem → promedio 152 → "high".
    const cuerpo140 = "y".repeat(140);
    const preguntas = Array.from({ length: 5 }, () => pregunta(opciones, cuerpo140));
    expect(computeSectionDensity(seccion(preguntas))).toBe("high");

    // 138 + 12 = 150 chars/ítem exacto → promedio 150 → "high" (no es <150).
    const cuerpo138 = "z".repeat(138);
    const preguntasLow = Array.from({ length: 5 }, () => pregunta(opciones, cuerpo138));
    expect(computeSectionDensity(seccion(preguntasLow))).toBe("high");

    // 137 + 12 = 149 chars/ítem → promedio 149 → "low".
    const cuerpo137 = "w".repeat(137);
    const preguntasLow2 = Array.from({ length: 5 }, () => pregunta(opciones, cuerpo137));
    expect(computeSectionDensity(seccion(preguntasLow2))).toBe("low");
  });
});

describe("resolveSectionDensity", () => {
  // Casos base: la heurística decidiría "low" (ítems cortos con varias opciones)
  // o "high" (ítems largos) según el contenido. El override se aplica sobre eso.

  it("override null → delega en la heurística (caso low)", () => {
    const opciones = ["a", "b", "c", "d"];
    const preguntas = Array.from({ length: 5 }, () => pregunta(opciones));
    expect(resolveSectionDensity(seccionConOverride(preguntas, null))).toBe("low");
  });

  it("override null → delega en la heurística (caso high)", () => {
    const cuerpoLargo = "y".repeat(200);
    const preguntas = Array.from({ length: 5 }, () => pregunta(["a", "b", "c", "d"], cuerpoLargo));
    expect(resolveSectionDensity(seccionConOverride(preguntas, null))).toBe("high");
  });

  it('override "2col" fuerza low aunque la heurística diría high', () => {
    const cuerpoLargo = "y".repeat(200);
    const preguntas = Array.from({ length: 5 }, () => pregunta(["a", "b", "c", "d"], cuerpoLargo));
    expect(resolveSectionDensity(seccionConOverride(preguntas, "2col"))).toBe("low");
  });

  it('override "1col" fuerza high aunque la heurística diría low', () => {
    // Ítems muy cortos: la heurística diría "low" (matching A-H).
    const opciones = [
      "bag",
      "bottle",
      "camera",
      "countryside",
      "helmet",
      "map",
      "station",
      "sweater",
    ];
    const preguntas = Array.from({ length: 5 }, () =>
      pregunta(opciones, "You put your clothes in it."),
    );
    expect(resolveSectionDensity(seccionConOverride(preguntas, "1col"))).toBe("high");
  });

  it('override "1col" también gana sobre imagen (forzar 1-col es seguro)', () => {
    const preguntas = Array.from({ length: 5 }, (_, i) =>
      i === 2
        ? { ...pregunta(["a", "b", "c", "d"]), image: "/x.jpg" }
        : pregunta(["a", "b", "c", "d"]),
    );
    expect(resolveSectionDensity(seccionConOverride(preguntas, "1col"))).toBe("high");
  });

  it("coincide con computeSectionDensity cuando override es null", () => {
    const preguntas = Array.from({ length: 5 }, () => pregunta(["a", "b", "c", "d"]));
    const sinOverride = seccion(preguntas);
    const conNull = seccionConOverride(preguntas, null);
    expect(resolveSectionDensity(sinOverride)).toBe(computeSectionDensity(sinOverride));
    expect(resolveSectionDensity(conNull)).toBe(computeSectionDensity(conNull));
  });
});
