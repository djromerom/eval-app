import { describe, expect, it } from "vitest";

import {
  createProtectedRegistry,
  extractProtectedText,
  rebuildProtectedDoc,
  tokensIn,
} from "@/modules/ai-review/application/protected-content";
import { enforceKeyConsistency } from "@/modules/ai-review/application/enforce-key";
import { parseReviewResponse } from "@/modules/ai-review/application/parse-review";
import {
  sanitizeAiText,
  tieneCaracteresNoLatinos,
} from "@/modules/ai-review/application/sanitize-text";
import { buildReviewUserMessage } from "@/modules/ai-review/application/review-prompt";
import { ReviewItem } from "@/modules/ai-review/application/review-item";
import type {
  AiItemReviewer,
  AiReviewInput,
  AiReviewVerdict,
} from "@/modules/ai-review/domain/ai-review";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";

// ---------------------------------------------------------------------------
// Actores
// ---------------------------------------------------------------------------

const teacher: AuthenticatedUser = {
  userId: "t1",
  institutionId: "inst1",
  roles: ["TEACHER"],
};

const sinPermisos: AuthenticatedUser = {
  userId: "u1",
  institutionId: "inst1",
  roles: [],
};

// ---------------------------------------------------------------------------
// Contenido protegido (fórmulas / imágenes)
// ---------------------------------------------------------------------------

const DOC_CON_FORMULA = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Calcula " },
        { type: "inlineMath", attrs: { tex: "x^2 + 3" } },
        { type: "text", text: " para x = 2." },
      ],
    },
  ],
};

const DOC_CON_IMAGEN = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Observa la figura:" }] },
    { type: "image", attrs: { src: "/uploads/a.png", alt: "círculo de radio 2" } },
  ],
};

describe("protected-content", () => {
  it("extrae el texto y esconde la fórmula detrás de un marcador", () => {
    const registry = createProtectedRegistry();
    const texto = extractProtectedText(DOC_CON_FORMULA, registry);

    expect(texto).toContain("Calcula");
    expect(texto).toContain("para x = 2.");
    expect(texto).not.toContain("x^2 + 3");
    expect(registry.elementos).toHaveLength(1);
    expect(registry.elementos[0]?.tipo).toBe("formula");
    expect(registry.elementos[0]?.contexto).toContain("x^2 + 3");
    expect(tokensIn(texto)).toEqual([registry.elementos[0]?.token]);
  });

  it("extrae el texto y esconde la imagen detrás de un marcador", () => {
    const registry = createProtectedRegistry();
    const texto = extractProtectedText(DOC_CON_IMAGEN, registry);

    expect(texto).toContain("Observa la figura:");
    expect(texto).not.toContain("/uploads/a.png");
    expect(registry.elementos[0]?.tipo).toBe("imagen");
    expect(registry.elementos[0]?.nivel).toBe("bloque");
    expect(registry.elementos[0]?.contexto).toContain("círculo de radio 2");
  });

  it("reconstruye el documento re-inyectando la fórmula en su lugar", () => {
    const registry = createProtectedRegistry();
    extractProtectedText(DOC_CON_FORMULA, registry);
    const token = registry.elementos[0]?.token ?? "";

    const doc = rebuildProtectedDoc(`Calcula ${token} para x = 2.`, registry, [token]);
    const parrafo = (doc.content[0] as { content?: { type: string }[] }).content ?? [];

    expect(doc.type).toBe("doc");
    expect(parrafo.map((n) => n.type)).toEqual(["text", "inlineMath", "text"]);
  });

  it("re-inyecta el nodo original aunque la IA haya omitido el marcador", () => {
    const registry = createProtectedRegistry();
    extractProtectedText(DOC_CON_FORMULA, registry);
    const token = registry.elementos[0]?.token ?? "";

    const doc = rebuildProtectedDoc("Calcula el valor para x = 2.", registry, [token]);
    const serializado = JSON.stringify(doc);

    expect(serializado).toContain("inlineMath");
    expect(serializado).toContain("x^2 + 3");
  });

  it("no pierde la imagen cuando la IA reescribe el texto", () => {
    const registry = createProtectedRegistry();
    extractProtectedText(DOC_CON_IMAGEN, registry);
    const token = registry.elementos[0]?.token ?? "";

    const doc = rebuildProtectedDoc(`Mira la figura ${token}.`, registry, [token]);

    expect(JSON.stringify(doc)).toContain("/uploads/a.png");
  });

  it("devuelve texto plano tal cual si el valor es un string", () => {
    const registry = createProtectedRegistry();
    expect(extractProtectedText("12 metros", registry)).toBe("12 metros");
    expect(registry.elementos).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Parseo de la respuesta del modelo
// ---------------------------------------------------------------------------

describe("parseReviewResponse", () => {
  it("parsea un JSON limpio", () => {
    const verdict = parseReviewResponse(
      JSON.stringify({
        aprobado: false,
        hallazgos: [
          {
            area: "clave",
            titulo: "La clave no corresponde",
            justificacion: "La opción A da 5 y la correcta es 7.",
            sugerencia: "Marcar la opción B.",
          },
        ],
        correccion: { enunciado: "texto", opciones: { A: "5", B: "7" }, clave: "B" },
      }),
    );

    expect(verdict?.aprobado).toBe(false);
    expect(verdict?.hallazgos).toHaveLength(1);
    expect(verdict?.hallazgos[0]?.area).toBe("clave");
    expect(verdict?.correccion?.clave).toBe("B");
  });

  it("parsea un JSON dentro de un bloque de código", () => {
    const verdict = parseReviewResponse(
      '```json\n{"aprobado": true, "hallazgos": [], "correccion": null}\n```',
    );
    expect(verdict?.aprobado).toBe(true);
    expect(verdict?.correccion).toBeNull();
  });

  it("parsea un JSON rodeado de texto", () => {
    const verdict = parseReviewResponse(
      'Claro. Aquí está el análisis: {"aprobado": true, "hallazgos": []} Fin.',
    );
    expect(verdict?.aprobado).toBe(true);
  });

  it("devuelve null si la respuesta no es JSON", () => {
    expect(parseReviewResponse("no puedo ayudar con eso")).toBeNull();
    expect(parseReviewResponse("")).toBeNull();
    expect(parseReviewResponse("{esto no es json")).toBeNull();
  });

  it("descarta hallazgos sin justificación", () => {
    const verdict = parseReviewResponse(
      JSON.stringify({
        aprobado: false,
        hallazgos: [{ area: "clave", titulo: "Algo", justificacion: "  " }],
        correccion: null,
      }),
    );
    expect(verdict?.aprobado).toBe(false);
    expect(verdict?.hallazgos).toHaveLength(0);
  });

  it("descarta una corrección con clave inválida", () => {
    const verdict = parseReviewResponse(
      JSON.stringify({
        aprobado: false,
        hallazgos: [],
        correccion: { enunciado: "texto", opciones: {}, clave: "Z" },
      }),
    );
    expect(verdict?.correccion).toBeNull();
  });

  it("lee la clave que resolvió la IA", () => {
    const verdict = parseReviewResponse(
      JSON.stringify({ aprobado: false, solucion: "b", hallazgos: [] }),
    );
    expect(verdict?.solucion).toBe("B");
  });

  it("parsea ignorando el bloque de razonamiento <think>", () => {
    const verdict = parseReviewResponse(
      '<think>El 25% de 12.000 es 3.000, así que la clave es B.</think>\n{"aprobado": false, "solucion": "B", "hallazgos": []}',
    );
    expect(verdict?.aprobado).toBe(false);
    expect(verdict?.solucion).toBe("B");
  });
});

// ---------------------------------------------------------------------------
// Caracteres no latinos (el modelo se pone a escribir en chino)
// ---------------------------------------------------------------------------

describe("sanitizeAiText", () => {
  it("elimina los ideogramas chinos", () => {
    expect(sanitizeAiText("lo que se debe求解.")).toBe("lo que se debe.");
  });

  it("elimina los ideogramas de una justificación", () => {
    const limpio = sanitizeAiText(
      "El enunciado solo contiene la palabra «prueba». No plantea una pregunta任何.",
    );
    expect(limpio).not.toContain("任何");
    expect(limpio).toContain("No plantea una pregunta.");
  });

  it("no toca las letras griegas ni los símbolos matemáticos", () => {
    const texto = "El ángulo α mide 30° y el área es ∑ = πr².";
    expect(sanitizeAiText(texto)).toBe(texto);
  });

  it("no toca el texto en español normal", () => {
    const texto = "La opción A da 2.000 y la B da 3.000; por eso la clave es B.";
    expect(sanitizeAiText(texto)).toBe(texto);
  });

  it("detecta si hay caracteres no latinos", () => {
    expect(tieneCaracteresNoLatinos("se debe求解")).toBe(true);
    expect(tieneCaracteresNoLatinos("se debe resolver")).toBe(false);
  });
});

describe("parseReviewResponse (limpieza de caracteres no latinos)", () => {
  it("limpia los hallazgos que traen ideogramas", () => {
    const verdict = parseReviewResponse(
      JSON.stringify({
        aprobado: false,
        hallazgos: [
          {
            area: "enunciado",
            titulo: "Ausencia de una pregunta resoluble",
            justificacion: "El enunciado solo contiene la palabra «prueba»求解.",
            sugerencia: "Reemplazar el enunciado por una pregunta completa.",
          },
        ],
        correccion: null,
      }),
    );

    expect(verdict?.hallazgos[0]?.justificacion).toBe(
      "El enunciado solo contiene la palabra «prueba».",
    );
    expect(verdict?.hallazgos[0]?.justificacion).not.toContain("求解");
  });

  it("limpia la corrección (enunciado y opciones)", () => {
    const verdict = parseReviewResponse(
      JSON.stringify({
        aprobado: false,
        hallazgos: [],
        correccion: {
          enunciado: "Calcula 5 + 3求解.",
          opciones: { A: "8", B: "9错" },
          clave: "A",
        },
      }),
    );

    expect(verdict?.correccion?.enunciado).toBe("Calcula 5 + 3.");
    expect(verdict?.correccion?.opciones.A).toBe("8");
    expect(verdict?.correccion?.opciones.B).toBe("9");
  });
});

// ---------------------------------------------------------------------------
// Regla de la clave (la IA resuelve, nosotros contrastamos)
// ---------------------------------------------------------------------------

describe("enforceKeyConsistency", () => {
  const item: AiReviewInput = {
    contexto: null,
    enunciado: "El 25% de 12.000 son niños. ¿Cuántos?",
    opciones: [
      { key: "A", texto: "2.000" },
      { key: "B", texto: "3.000" },
    ],
    clave: "A",
    protegidos: [],
  };

  it("deja pasar el ítem si la IA resolvió lo mismo que el docente", () => {
    const verdict = enforceKeyConsistency(
      { aprobado: true, solucion: "A", hallazgos: [], correccion: null },
      item,
    );
    expect(verdict.aprobado).toBe(true);
  });

  it("bloquea el ítem si la IA resolvió una clave distinta, aunque la IA lo aprobó", () => {
    const verdict = enforceKeyConsistency(
      { aprobado: true, solucion: "B", hallazgos: [], correccion: null },
      item,
    );

    expect(verdict.aprobado).toBe(false);
    expect(verdict.hallazgos).toHaveLength(1);
    expect(verdict.hallazgos[0]?.area).toBe("clave");
    expect(verdict.hallazgos[0]?.justificacion).toContain("B");
    // Y se arma una corrección para que el docente pueda aplicarla de un clic.
    expect(verdict.correccion?.clave).toBe("B");
    expect(verdict.correccion?.enunciado).toBe(item.enunciado);
  });

  it("no duplica el hallazgo de clave si la IA ya lo reportó", () => {
    const verdict = enforceKeyConsistency(
      {
        aprobado: false,
        solucion: "B",
        hallazgos: [{ area: "clave", titulo: "t", justificacion: "j", sugerencia: "s" }],
        correccion: null,
      },
      item,
    );
    expect(verdict.hallazgos).toHaveLength(1);
  });

  it("no hace nada si la IA no resolvió el ítem", () => {
    const original = { aprobado: true, hallazgos: [], correccion: null };
    expect(enforceKeyConsistency(original, item)).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

describe("buildReviewUserMessage", () => {
  const input: AiReviewInput = {
    contexto: { titulo: "Censo", texto: "Contexto del enunciado" },
    enunciado: "Cuántos habitantes hay?",
    opciones: [
      { key: "A", texto: "10" },
      { key: "B", texto: "20" },
    ],
    clave: "B",
    protegidos: [{ token: "⟦F1⟧", tipo: "formula", contexto: "fórmula: x^2" }],
  };

  it("incluye contexto, enunciado, opciones, clave y protegidos", () => {
    const msg = buildReviewUserMessage(input);

    expect(msg).toContain("Censo");
    expect(msg).toContain("Contexto del enunciado");
    expect(msg).toContain("Cuántos habitantes hay?");
    expect(msg).toContain("A) 10");
    expect(msg).toContain("B) 20");
    expect(msg).toContain("Clave marcada por el docente: B");
    expect(msg).toContain("⟦F1⟧");
  });

  it("omite el bloque de contexto cuando no hay", () => {
    const msg = buildReviewUserMessage({ ...input, contexto: null });
    expect(msg).not.toContain("## Contexto");
  });
});

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

class FakeReviewer implements AiItemReviewer {
  calls: AiReviewInput[] = [];
  verdict: AiReviewVerdict = { aprobado: true, hallazgos: [], correccion: null };
  error: Error | null = null;

  async review(input: AiReviewInput): Promise<AiReviewVerdict> {
    this.calls.push(input);
    if (this.error) throw this.error;
    return this.verdict;
  }
}

describe("ReviewItem (caso de uso)", () => {
  it("rechaza a un actor sin rol de docente", async () => {
    const reviewer = new FakeReviewer();
    const result = await new ReviewItem(reviewer).execute({
      actor: sinPermisos,
      item: { contexto: null, enunciado: "x", opciones: [], clave: "A", protegidos: [] },
    });

    expect(result.ok).toBe(false);
    expect(reviewer.calls).toHaveLength(0);
  });

  it("devuelve el veredicto del proveedor", async () => {
    const reviewer = new FakeReviewer();
    reviewer.verdict = {
      aprobado: false,
      hallazgos: [{ area: "clave", titulo: "t", justificacion: "j", sugerencia: "s" }],
      correccion: null,
    };

    const result = await new ReviewItem(reviewer).execute({
      actor: teacher,
      item: { contexto: null, enunciado: "x", opciones: [], clave: "A", protegidos: [] },
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.aprobado).toBe(false);
  });

  it("devuelve un error legible si el proveedor falla", async () => {
    const reviewer = new FakeReviewer();
    reviewer.error = new Error("timeout");

    const result = await new ReviewItem(reviewer).execute({
      actor: teacher,
      item: { contexto: null, enunciado: "x", opciones: [], clave: "A", protegidos: [] },
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe("AI_REVIEW_FAILED");
  });
});
