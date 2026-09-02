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
  computeGroupDensity,
  computeSectionDensity,
  resolveGroupDensity,
  resolveSectionDensity,
  richTextCharCount,
} from "@/modules/printing/domain/section-density";
import type { SectionGroup } from "@/modules/printing/domain/section-grouping";
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

/**
 * `computeGroupDensity` y `resolveGroupDensity` cubren el caso del sprint
 * Sep 2026: cuando el docente apila varias secciones "ninguno" consecutivas,
 * cada una por separado sería "high" (vacía o de 1 ítem) y desperdiciaría la
 * página. Fusionadas en `none-merged`, la suma de ítems cortos activa la
 * regla de chars/ítem < 150 → "low" y la sección entera pasa a 2 columnas.
 */
describe("computeGroupDensity", () => {
  it("single delega en computeSectionDensity", () => {
    // Mismo comportamiento que ya cubre el bloque de arriba: verificar que
    // el contrato `single → computeSectionDensity(section)` se mantiene.
    const group: SectionGroup = {
      kind: "single",
      section: seccion(Array.from({ length: 5 }, () => pregunta(["a", "b", "c", "d"]))),
    };
    expect(computeGroupDensity(group)).toBe("low");
  });

  it("none-merged vacío → high", () => {
    const group: SectionGroup = { kind: "none-merged", sections: [] };
    expect(computeGroupDensity(group)).toBe("high");
  });

  it("none-merged de 1 ítem → high (la fusión no engaña al umbral de 1 ítem)", () => {
    const s = seccion([pregunta(["a", "b", "c", "d"])]);
    const group: SectionGroup = { kind: "none-merged", sections: [s] };
    expect(computeGroupDensity(group)).toBe("high");
  });

  it("none-merged con un ítem corto por sección, total <150 chars/ítem → low", () => {
    // Caso real INGLÉS PARTE 1: 5 secciones 'ninguno' con 1 ítem cada una,
    // cada ítem corto (5 chars/ítem aprox). Fusionadas → 5 ítems cortos
    // → 25 chars/5 = 5 chars/ítem → low (2-col).
    const opciones = ["a", "b", "c", "d"];
    const items = Array.from({ length: 5 }, () => seccion([pregunta(opciones, "x")]));
    const group: SectionGroup = { kind: "none-merged", sections: items };
    expect(computeGroupDensity(group)).toBe("low");
  });

  it("none-merged con ítems largos → high aunque el nº total sea bajo", () => {
    const cuerpoLargo = "y".repeat(200);
    const items = Array.from({ length: 5 }, () =>
      seccion([pregunta(["a", "b", "c", "d"], cuerpoLargo)]),
    );
    const group: SectionGroup = { kind: "none-merged", sections: items };
    expect(computeGroupDensity(group)).toBe("high");
  });

  it("none-merged con UNA imagen entre shorts → high (la imagen rompe flujo)", () => {
    const items = Array.from({ length: 5 }, (_, idx) =>
      seccion([
        idx === 2
          ? { ...pregunta(["a", "b", "c", "d"]), image: "/x.jpg" }
          : pregunta(["a", "b", "c", "d"]),
      ]),
    );
    const group: SectionGroup = { kind: "none-merged", sections: items };
    expect(computeGroupDensity(group)).toBe("high");
  });

  it("none-merged suma chars a través de varias secciones", () => {
    // 3 secciones, 2 ítems cortos cada una → 6 ítems cortos. Si fueran 3
    // secciones independientes, cada una vería 2 ítems cortos → low, pero
    // la regla de "1 ítem → high" no aplicaría porque hay 2 por sección.
    // Lo que prueba este test: la fusión NUNCA empeora una decisión ya baja.
    const items = Array.from({ length: 3 }, () =>
      seccion([pregunta(["a", "b", "c", "d"]), pregunta(["a", "b", "c", "d"])]),
    );
    const group: SectionGroup = { kind: "none-merged", sections: items };
    expect(computeGroupDensity(group)).toBe("low");
  });

  it("none-merged donde la 1ª sección está vacía y la 2ª tiene 2 ítems cortos → low", () => {
    // Caso típico: docente arrastra una sección vacía al final del batch.
    // La fusión evita que la sección vacía (high por sí misma) contamine
    // el cálculo del grupo entero.
    const vacia = seccion([]);
    const conDosCorto = seccion([pregunta(["a", "b", "c", "d"]), pregunta(["a", "b", "c", "d"])]);
    const group: SectionGroup = { kind: "none-merged", sections: [vacia, conDosCorto] };
    expect(computeGroupDensity(group)).toBe("low");
  });
});

describe("resolveGroupDensity", () => {
  it("single con override 2col → low", () => {
    const s = seccionConOverride(
      Array.from({ length: 5 }, () => pregunta(["a", "b", "c", "d"])),
      "2col",
    );
    expect(resolveGroupDensity({ kind: "single", section: s })).toBe("low");
  });

  it("single con override 1col → high", () => {
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
    const s = seccionConOverride(
      Array.from({ length: 5 }, () => pregunta(opciones, "You put your clothes in it.")),
      "1col",
    );
    expect(resolveGroupDensity({ kind: "single", section: s })).toBe("high");
  });

  it("none-merged: override de la 1ª sección controla el grupo entero", () => {
    // Tres secciones "ninguno" con un ítem corto cada una → heurística low.
    // Pero la 1ª lleva override "1col" → gana, todo el grupo va a 1-col.
    const items = [
      seccionConOverride([pregunta(["a", "b", "c", "d"])], "1col"),
      seccion([pregunta(["a", "b", "c", "d"])]),
      seccion([pregunta(["a", "b", "c", "d"])]),
    ];
    expect(resolveGroupDensity({ kind: "none-merged", sections: items })).toBe("high");
  });

  it("none-merged: override de secciones interiores se ignora", () => {
    // La 1ª sección no tiene override (heurística low), la 2ª tiene "1col".
    // La del medio NO debe imponerse: se respeta solo la 1ª.
    const items = [
      seccion([pregunta(["a", "b", "c", "d"])]),
      seccionConOverride([pregunta(["a", "b", "c", "d"])], "1col"),
      seccion([pregunta(["a", "b", "c", "d"])]),
    ];
    expect(resolveGroupDensity({ kind: "none-merged", sections: items })).toBe("low");
  });
});
