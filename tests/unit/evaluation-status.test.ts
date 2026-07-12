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
    expect(canTransition("DRAFT", "PUBLISHED", ["COORDINATOR"])).toBe(false);
    expect(canTransition("PUBLISHED", "APPROVED", ["TEACHER"])).toBe(false);
  });

  it("solo las evaluaciones publicadas se imprimen", () => {
    expect(isPrintable("PUBLISHED")).toBe(true);
    expect(isPrintable("APPROVED")).toBe(false);
    expect(isPrintable("DRAFT")).toBe(false);
  });
});
