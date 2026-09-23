import { describe, expect, it } from "vitest";
import {
  assertDejaAlMenosUnaEfectiva,
  filtrarPreguntasEfectivas,
  type BundleQuestionRef,
} from "@/modules/bundles/domain/disabled-bundle-question";

describe("filtrarPreguntasEfectivas", () => {
  const preguntas: BundleQuestionRef[] = [
    { questionId: "q1" },
    { questionId: "q2" },
    { questionId: "q3" },
  ];

  it("devuelve todas si no hay inhabitadas", () => {
    expect(filtrarPreguntasEfectivas(preguntas, new Set()).map((p) => p.questionId)).toEqual([
      "q1",
      "q2",
      "q3",
    ]);
  });

  it("excluye las inhabitadas", () => {
    expect(filtrarPreguntasEfectivas(preguntas, new Set(["q2"])).map((p) => p.questionId)).toEqual([
      "q1",
      "q3",
    ]);
  });

  it("devuelve [] si todas estan inhabitadas", () => {
    expect(filtrarPreguntasEfectivas(preguntas, new Set(["q1", "q2", "q3"]))).toEqual([]);
  });

  it("preserva el orden de entrada", () => {
    const out = filtrarPreguntasEfectivas(preguntas, new Set(["q2"]));
    expect(out.map((p) => p.questionId)).toEqual(["q1", "q3"]);
  });
});

describe("assertDejaAlMenosUnaEfectiva", () => {
  it("re-habilitar nunca deja al bundle vacio", () => {
    const r = assertDejaAlMenosUnaEfectiva({
      totalPreguntasBundle: 5,
      idsYaInhabilitados: new Set(["q1", "q2", "q3", "q4", "q5"]),
      intentaInhabilitar: false,
      questionId: "q1",
    });
    expect(r.ok).toBe(true);
  });

  it("bloquea si intenta inhabitar la ultima efectiva", () => {
    const r = assertDejaAlMenosUnaEfectiva({
      totalPreguntasBundle: 5,
      idsYaInhabilitados: new Set(["q1", "q2", "q3", "q4"]),
      intentaInhabilitar: true,
      questionId: "q5",
    });
    expect(r).toEqual({ ok: false, reason: "WOULD_LEAVE_EMPTY" });
  });

  it("permite inhabitar si queda >=1 efectiva", () => {
    const r = assertDejaAlMenosUnaEfectiva({
      totalPreguntasBundle: 5,
      idsYaInhabilitados: new Set(["q1", "q2"]),
      intentaInhabilitar: true,
      questionId: "q3",
    });
    expect(r.ok).toBe(true);
  });

  it("re-toggling (ya estaba inhabitada) no cambia el resultado", () => {
    const r = assertDejaAlMenosUnaEfectiva({
      totalPreguntasBundle: 2,
      idsYaInhabilitados: new Set(["q1"]),
      intentaInhabilitar: true,
      questionId: "q1",
    });
    expect(r.ok).toBe(true);
  });

  it("bloquea si intenta inhabititar la unica efectiva (1 pregunta bundle)", () => {
    const r = assertDejaAlMenosUnaEfectiva({
      totalPreguntasBundle: 1,
      idsYaInhabilitados: new Set<string>(),
      intentaInhabilitar: true,
      questionId: "q1",
    });
    expect(r).toEqual({ ok: false, reason: "WOULD_LEAVE_EMPTY" });
  });
});
