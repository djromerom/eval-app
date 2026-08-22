/**
 * Tests del parser defensivo y del merge de CoverContent (PR 1 + PR 2).
 *
 * El JSONB que llega de Prisma puede tener campos mal formados (el admin
 * edita a mano, copia JSON de otra institución, etc.). El parser NUNCA
 * debe descartar el objeto entero por un campo malo — solo descarta
 * ESE campo y deja que el resto sobreviva para que en runtime `mergeCoverContent`
 * lo rellene con defaults.
 *
 * El merge aplica la precedencia bundle > institución > DEFAULT_* sin
 * combinar arrays profundo.
 */
import { describe, expect, it } from "vitest";
import { mergeCoverContent, parseCoverContent } from "@/modules/bundle-cover/domain/cover-content";
import {
  DEFAULT_CALLOUT_TEXT,
  DEFAULT_HOW_TO_MARK_EXAMPLE,
  DEFAULT_HOW_TO_MARK_LABEL,
  DEFAULT_HOW_TO_MARK_QUESTION,
  DEFAULT_INSTRUCTIONS_ITEMS_AFTER,
  DEFAULT_INSTRUCTIONS_ITEMS_BEFORE,
  DEFAULT_INSTRUCTIONS_TITLE,
  DEFAULT_LEGAL_FOOTER,
  DEFAULT_PROHIBITED_BODY,
  DEFAULT_PROHIBITED_TITLE,
} from "@/modules/bundle-cover/application/cover-defaults";

describe("parseCoverContent", () => {
  describe("casos felices", () => {
    it("devuelve {} cuando el input es null", () => {
      expect(parseCoverContent(null)).toEqual({});
    });

    it("devuelve {} cuando el input es undefined", () => {
      expect(parseCoverContent(undefined)).toEqual({});
    });

    it("devuelve {} cuando el input no es objeto", () => {
      expect(parseCoverContent("string")).toEqual({});
      expect(parseCoverContent(42)).toEqual({});
      expect(parseCoverContent(true)).toEqual({});
    });

    it("parsea un objeto con todos los campos válidos", () => {
      const raw = {
        legalFooter: "Resolución 0001 de 2026",
        instructionsTitle: "Indicaciones",
        itemsBefore: ["Lea cada pregunta", "No use corrector"],
        calloutText: "Marque con lápiz negro",
        howToMarkQuestion: "¿Cómo marcar?",
        howToMarkExampleLabel: "ASÍ",
        itemsAfter: ["Verifique", "Firme"],
        prohibitedTitle: "No permitido",
        prohibitedBody: "No usar teléfonos.",
      };
      expect(parseCoverContent(raw)).toEqual(raw);
    });

    it("acepta itemsBefore con menos de 10 ítems y respeta el orden", () => {
      const raw = { itemsBefore: ["a", "b", "c"] };
      expect(parseCoverContent(raw).itemsBefore).toEqual(["a", "b", "c"]);
    });

    it("acepta itemsAfter con hasta 15 ítems", () => {
      const raw = {
        itemsAfter: Array.from({ length: 15 }, (_, i) => `ítem ${i + 1}`),
      };
      expect(parseCoverContent(raw).itemsAfter).toHaveLength(15);
    });
  });

  describe("defensa campo por campo", () => {
    it("descarta un campo string que excede el maxLength pero conserva el resto", () => {
      const tooLong = "x".repeat(301);
      const raw = {
        legalFooter: tooLong,
        instructionsTitle: "OK",
        prohibitedBody: "Texto válido",
      };
      const out = parseCoverContent(raw);
      expect(out.legalFooter).toBeUndefined();
      expect(out.instructionsTitle).toBe("OK");
      expect(out.prohibitedBody).toBe("Texto válido");
    });

    it("descarta itemsBefore si no es array pero conserva los otros campos", () => {
      const raw = {
        itemsBefore: "no es array",
        itemsAfter: ["válido 1", "válido 2"],
        calloutText: "válido",
      };
      const out = parseCoverContent(raw);
      expect(out.itemsBefore).toBeUndefined();
      expect(out.itemsAfter).toEqual(["válido 1", "válido 2"]);
      expect(out.calloutText).toBe("válido");
    });

    it("descarta los ítems que no son strings dentro de un array", () => {
      const raw = {
        itemsBefore: ["válido 1", 42, null, "válido 2", { a: 1 }],
      };
      expect(parseCoverContent(raw).itemsBefore).toEqual(["válido 1", "válido 2"]);
    });

    it("limita itemsBefore a 10 ítems aunque el array tenga más", () => {
      const raw = {
        itemsBefore: Array.from({ length: 20 }, (_, i) => `ítem ${i + 1}`),
      };
      expect(parseCoverContent(raw).itemsBefore).toHaveLength(10);
    });

    it("limita itemsAfter a 15 ítems aunque el array tenga más", () => {
      const raw = {
        itemsAfter: Array.from({ length: 30 }, (_, i) => `ítem ${i + 1}`),
      };
      expect(parseCoverContent(raw).itemsAfter).toHaveLength(15);
    });

    it("descarta un ítem de array si excede 200 chars pero conserva el resto", () => {
      const tooLong = "x".repeat(201);
      const raw = {
        itemsBefore: ["válido", tooLong, "válido 2"],
      };
      expect(parseCoverContent(raw).itemsBefore).toEqual(["válido", "válido 2"]);
    });

    it("devuelve undefined para itemsBefore si TODOS los ítems son inválidos", () => {
      const raw = {
        itemsBefore: [42, null, true],
      };
      expect(parseCoverContent(raw).itemsBefore).toBeUndefined();
    });

    it("descarta campos con tipo incorrecto pero conserva los válidos", () => {
      const raw = {
        legalFooter: 123, // number, no string
        instructionsTitle: "válido",
        calloutText: ["array", "no", "string"], // array, no string
        howToMarkQuestion: null, // null explícito
      };
      const out = parseCoverContent(raw);
      expect(out.legalFooter).toBeUndefined();
      expect(out.instructionsTitle).toBe("válido");
      expect(out.calloutText).toBeUndefined();
      expect(out.howToMarkQuestion).toBeUndefined();
    });
  });

  describe("límites de longitud por campo", () => {
    it("legalFooter acepta hasta 300 chars", () => {
      expect(parseCoverContent({ legalFooter: "x".repeat(300) }).legalFooter).toHaveLength(300);
    });

    it("instructionsTitle acepta hasta 80 chars", () => {
      expect(
        parseCoverContent({ instructionsTitle: "x".repeat(80) }).instructionsTitle,
      ).toHaveLength(80);
    });

    it("calloutText acepta hasta 400 chars", () => {
      expect(parseCoverContent({ calloutText: "x".repeat(400) }).calloutText).toHaveLength(400);
    });

    it("howToMarkQuestion acepta hasta 400 chars", () => {
      expect(
        parseCoverContent({ howToMarkQuestion: "x".repeat(400) }).howToMarkQuestion,
      ).toHaveLength(400);
    });

    it("howToMarkExampleLabel acepta hasta 80 chars", () => {
      expect(
        parseCoverContent({ howToMarkExampleLabel: "x".repeat(80) }).howToMarkExampleLabel,
      ).toHaveLength(80);
    });

    it("prohibitedTitle acepta hasta 80 chars", () => {
      expect(parseCoverContent({ prohibitedTitle: "x".repeat(80) }).prohibitedTitle).toHaveLength(
        80,
      );
    });

    it("prohibitedBody acepta hasta 800 chars", () => {
      expect(parseCoverContent({ prohibitedBody: "x".repeat(800) }).prohibitedBody).toHaveLength(
        800,
      );
    });
  });

  describe("howToMarkExample (añadido en PR 2)", () => {
    it("parsea el campo cuando es string válido", () => {
      expect(parseCoverContent({ howToMarkExample: "Por ejemplo, si B" }).howToMarkExample).toBe(
        "Por ejemplo, si B",
      );
    });

    it("descarta strings que exceden 200 chars", () => {
      const tooLong = "x".repeat(201);
      expect(parseCoverContent({ howToMarkExample: tooLong }).howToMarkExample).toBeUndefined();
    });

    it("descarta si no es string", () => {
      expect(parseCoverContent({ howToMarkExample: 42 }).howToMarkExample).toBeUndefined();
    });
  });
});

// ===========================================================================
// mergeCoverContent (PR 2)
// ===========================================================================

describe("mergeCoverContent", () => {
  it("devuelve todos los DEFAULTs cuando ambos lados están vacíos", () => {
    expect(mergeCoverContent({}, {})).toEqual({
      legalFooter: DEFAULT_LEGAL_FOOTER,
      instructionsTitle: DEFAULT_INSTRUCTIONS_TITLE,
      itemsBefore: DEFAULT_INSTRUCTIONS_ITEMS_BEFORE,
      calloutText: DEFAULT_CALLOUT_TEXT,
      howToMarkQuestion: DEFAULT_HOW_TO_MARK_QUESTION,
      howToMarkExample: DEFAULT_HOW_TO_MARK_EXAMPLE,
      howToMarkExampleLabel: DEFAULT_HOW_TO_MARK_LABEL,
      itemsAfter: DEFAULT_INSTRUCTIONS_ITEMS_AFTER,
      prohibitedTitle: DEFAULT_PROHIBITED_TITLE,
      prohibitedBody: DEFAULT_PROHIBITED_BODY,
    });
  });

  it("el bundle gana sobre la institución", () => {
    const institutional = {
      legalFooter: "Institucional",
      calloutText: "Callout institucional",
      itemsBefore: ["a1", "a2"],
    };
    const bundle = {
      calloutText: "Callout del bundle",
    };
    const out = mergeCoverContent(institutional, bundle);
    expect(out.calloutText).toBe("Callout del bundle"); // bundle gana
    expect(out.legalFooter).toBe("Institucional"); // solo institucional
    expect(out.itemsBefore).toEqual(["a1", "a2"]); // solo institucional
    // resto: defaults
    expect(out.howToMarkQuestion).toBe(DEFAULT_HOW_TO_MARK_QUESTION);
  });

  it("si la institución trae un campo y el bundle NO, usa el institucional", () => {
    const institutional = { prohibitedBody: "No usar teléfonos institucionales" };
    const bundle = { calloutText: "Bundle callout" };
    const out = mergeCoverContent(institutional, bundle);
    expect(out.prohibitedBody).toBe("No usar teléfonos institucionales");
    expect(out.calloutText).toBe("Bundle callout");
  });

  it("el bundle SOBREESCRIBE el array completo de la institución (no concatena)", () => {
    const institutional = { itemsBefore: ["a", "b"] };
    const bundle = { itemsBefore: ["x", "y", "z"] };
    expect(mergeCoverContent(institutional, bundle).itemsBefore).toEqual(["x", "y", "z"]);
  });

  it("maneja null/undefined en ambos lados tratándolos como {}", () => {
    expect(mergeCoverContent(null as never, null as never).calloutText).toBe(DEFAULT_CALLOUT_TEXT);
    expect(mergeCoverContent(undefined as never, undefined as never).howToMarkExample).toBe(
      DEFAULT_HOW_TO_MARK_EXAMPLE,
    );
  });

  it("howToMarkExample: bundle gana; si no, institucional; si no, default", () => {
    expect(mergeCoverContent({}, {}).howToMarkExample).toBe(DEFAULT_HOW_TO_MARK_EXAMPLE);
    expect(mergeCoverContent({ howToMarkExample: "Ins" }, {}).howToMarkExample).toBe("Ins");
    expect(
      mergeCoverContent({ howToMarkExample: "Ins" }, { howToMarkExample: "Bun" }).howToMarkExample,
    ).toBe("Bun");
  });
});
