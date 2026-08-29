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
    expect(canTransition("IN_REVIEW", "APPROVED", ["ECU_LIDER"])).toBe(true);
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
    expect(canTransition("DRAFT", "PUBLISHED", ["ECU_LIDER"])).toBe(true);
    expect(canTransition("DRAFT", "PUBLISHED", ["ECU_MASTER"])).toBe(false);
    // No exige comentario (es la versión final, no un rechazo).
    expect(findTransition("DRAFT", "PUBLISHED")?.requiresComment).toBe(false);
  });

  it("el flujo canónico PUBLISHED sigue pasando por APPROVED", () => {
    // APPROVED → PUBLISHED (canónico) debe seguir funcionando.
    expect(canTransition("APPROVED", "PUBLISHED", ["TEACHER"])).toBe(true);
    expect(canTransition("APPROVED", "PUBLISHED", ["ECU_LIDER"])).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Sprint ago 2026: revertir a DRAFT desde APPROVED y PUBLISHED para ECU_LIDER.
  // El líder ECU puede sacar una formulación aprobada antes de imprimirla
  // (rechazo tardío, requiere comentario) o revertir una ya publicada
  // (rollback, no requiere comentario). Ver módulo de revisión del coordinador.
  // ---------------------------------------------------------------------------

  it("ECU_LIDER puede revertir APPROVED → DRAFT (rechazo tardío, requiere comment)", () => {
    expect(canTransition("APPROVED", "DRAFT", ["ECU_LIDER"])).toBe(true);
    expect(findTransition("APPROVED", "DRAFT")?.requiresComment).toBe(true);
  });

  it("TEACHER NO puede revertir APPROVED → DRAFT (solo ECU_LIDER)", () => {
    expect(canTransition("APPROVED", "DRAFT", ["TEACHER"])).toBe(false);
  });

  it("ECU_LIDER puede revertir PUBLISHED → DRAFT (rollback, sin comment)", () => {
    expect(canTransition("PUBLISHED", "DRAFT", ["ECU_LIDER"])).toBe(true);
    expect(findTransition("PUBLISHED", "DRAFT")?.requiresComment).toBe(false);
  });

  it("TEACHER sigue pudiendo revertir PUBLISHED → DRAFT (sin comment, regression)", () => {
    expect(canTransition("PUBLISHED", "DRAFT", ["TEACHER"])).toBe(true);
    expect(findTransition("PUBLISHED", "DRAFT")?.requiresComment).toBe(false);
  });

  it("ECU_MASTER NO puede revertir APPROVED → DRAFT (es transición del líder)", () => {
    // El rollback desde APPROVED/PUBLISHED es del líder pedagógico, no del
    // admin institucional. El admin tiene otros caminos (force-update, etc.).
    expect(canTransition("APPROVED", "DRAFT", ["ECU_MASTER"])).toBe(false);
    expect(canTransition("PUBLISHED", "DRAFT", ["ECU_MASTER"])).toBe(false);
  });

  it("solo las evaluaciones publicadas se imprimen", () => {
    expect(isPrintable("PUBLISHED")).toBe(true);
    expect(isPrintable("APPROVED")).toBe(false);
    expect(isPrintable("DRAFT")).toBe(false);
  });
});
