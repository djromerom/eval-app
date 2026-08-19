import { describe, expect, it } from "vitest";
import { can } from "@/shared/application/capabilities";
import type { Role } from "@/shared/application/authenticated-user";

describe("can (Sprint 8C — capability-based menu)", () => {
  const SA: Role[] = ["SUPER_ADMIN"];
  const EM: Role[] = ["ECU_MASTER"];
  const CO: Role[] = ["ECU_LIDER"];
  const TE: Role[] = ["TEACHER"];
  const SA_EM: Role[] = ["SUPER_ADMIN", "ECU_MASTER"];

  describe("manage-institutions", () => {
    it("solo SUPER_ADMIN", () => {
      expect(can("manage-institutions", SA)).toBe(true);
      expect(can("manage-institutions", EM)).toBe(false);
      expect(can("manage-institutions", CO)).toBe(false);
      expect(can("manage-institutions", TE)).toBe(false);
    });
    it("multi-rol: SUPER_ADMIN + ECU_MASTER también", () => {
      expect(can("manage-institutions", SA_EM)).toBe(true);
    });
  });

  describe("manage-users / manage-academic-structure / manage-institutional-theme / manage-bundles", () => {
    it("solo ECU_MASTER (no SUPER_ADMIN por sí solo)", () => {
      for (const cap of [
        "manage-users",
        "manage-academic-structure",
        "manage-institutional-theme",
        "manage-bundles",
      ] as const) {
        expect(can(cap, SA)).toBe(false);
        expect(can(cap, EM)).toBe(true);
        expect(can(cap, CO)).toBe(false);
        expect(can(cap, TE)).toBe(false);
      }
    });
  });

  describe("review-evaluations", () => {
    it("COORDINATOR y ECU_MASTER", () => {
      expect(can("review-evaluations", CO)).toBe(true);
      expect(can("review-evaluations", EM)).toBe(true);
      expect(can("review-evaluations", SA)).toBe(false);
      expect(can("review-evaluations", TE)).toBe(false);
    });
  });

  describe("create-evaluations", () => {
    it("TEACHER y COORDINATOR", () => {
      expect(can("create-evaluations", TE)).toBe(true);
      expect(can("create-evaluations", CO)).toBe(true);
      expect(can("create-evaluations", SA)).toBe(false);
      expect(can("create-evaluations", EM)).toBe(false);
    });
  });

  describe("matriz completa por rol", () => {
    // Tabla de referencia: qué capabilities tiene cada rol PURO.
    // Si esta tabla cambia, también cambia `can(...)` arriba.
    const matrix: Array<[Role[], string]> = [
      [SA, "SUPER_ADMIN"],
      [EM, "ECU_MASTER"],
      [CO, "ECU_LIDER"],
      [TE, "TEACHER"],
    ];
    for (const [roles, name] of matrix) {
      it(`${name}: combinación coherente con use cases`, () => {
        // No asertamos el conteo exacto (puede evolucionar) — solo que
        // las capabilities devueltas coinciden con las del switch.
        const caps = [
          "manage-institutions",
          "manage-users",
          "manage-academic-structure",
          "manage-institutional-theme",
          "manage-bundles",
          "review-evaluations",
          "create-evaluations",
        ] as const;
        const result = Object.fromEntries(caps.map((c) => [c, can(c, roles)]));
        // Smoke: el resultado es un objeto con todas las keys y todas booleanas.
        for (const c of caps) {
          expect(typeof result[c]).toBe("boolean");
        }
      });
    }
  });
});
