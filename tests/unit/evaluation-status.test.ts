import { describe, expect, it } from "vitest";
import {
  canTransition,
  findTransition,
  isPrintable,
} from "@/modules/evaluations/domain/evaluation-status";

describe("máquina de estados de evaluación", () => {
  it("un docente puede enviar a revisión (DRAFT → IN_REVIEW)", () => {
    expect(canTransition("DRAFT", "IN_REVIEW", ["TEACHER"])).toBe(true);
  });

  it("solo el coordinador aprueba (IN_REVIEW → APPROVED)", () => {
    expect(canTransition("IN_REVIEW", "APPROVED", ["COORDINATOR"])).toBe(true);
    expect(canTransition("IN_REVIEW", "APPROVED", ["TEACHER"])).toBe(false);
  });

  it("el rechazo exige comentario", () => {
    expect(findTransition("IN_REVIEW", "DRAFT")?.requiresComment).toBe(true);
  });

  it("no permite transiciones inexistentes", () => {
    // PUBLISHED → APPROVED no es una transición válida (el flujo va
    // APPROVED → PUBLISHED, no al revés). La transición directa
    // DRAFT → PUBLISHED SÍ existe desde ago 2026 (atajo del editor
    // unificado); la cubrimos en el siguiente test.
    expect(canTransition("PUBLISHED", "APPROVED", ["TEACHER"])).toBe(false);
    expect(canTransition("APPROVED", "DRAFT", ["TEACHER"])).toBe(false);
  });

  it("atajo DRAFT → PUBLISHED del editor unificado (ago 2026)", () => {
    // Roles permitidos: TEACHER (será dueño por la regla de ownership del
    // use case) o COORDINATOR. ECU_MASTER no — la transición la dispara
    // el docente, no el master.
    expect(canTransition("DRAFT", "PUBLISHED", ["TEACHER"])).toBe(true);
    expect(canTransition("DRAFT", "PUBLISHED", ["COORDINATOR"])).toBe(true);
    expect(canTransition("DRAFT", "PUBLISHED", ["ECU_MASTER"])).toBe(false);
    // No exige comentario (es la versión final, no un rechazo).
    expect(findTransition("DRAFT", "PUBLISHED")?.requiresComment).toBe(false);
  });

  it("el flujo canónico PUBLISHED sigue pasando por APPROVED", () => {
    // APPROVED → PUBLISHED (canónico) debe seguir funcionando.
    expect(canTransition("APPROVED", "PUBLISHED", ["TEACHER"])).toBe(true);
    expect(canTransition("APPROVED", "PUBLISHED", ["COORDINATOR"])).toBe(true);
  });

  it("solo las evaluaciones publicadas se imprimen", () => {
    expect(isPrintable("PUBLISHED")).toBe(true);
    expect(isPrintable("APPROVED")).toBe(false);
    expect(isPrintable("DRAFT")).toBe(false);
  });
});
