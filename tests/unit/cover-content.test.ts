/**
 * Tests del parser defensivo de CoverContent (PR 1).
 *
 * El JSONB que llega de Prisma puede tener campos mal formados (el admin
 * edita a mano, copia JSON de otra institución, etc.). El parser NUNCA
 * debe descartar el objeto entero por un campo malo — solo descarta
 * ESE campo y deja que el resto sobreviva para que en runtime `mergeCoverContent`
 * lo rellene con defaults.
 */
import { describe, expect, it } from "vitest";
import { parseCoverContent } from "@/modules/bundle-cover/domain/cover-content";

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
});
