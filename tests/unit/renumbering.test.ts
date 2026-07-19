/**
 * Tests de `computeRenumbering`: la numeración continua de las preguntas de
 * una evaluación tras borrar una pregunta o un contexto.
 *
 * Es la parte delicada del borrado. El cuadernillo numera de corrido en toda
 * la evaluación y la hoja OMR asume esa correspondencia, así que un hueco
 * desalinearía las burbujas respecto de las respuestas.
 */
import { describe, expect, it } from "vitest";
import { computeRenumbering } from "@/modules/evaluations/domain/evaluation";

/** Atajo: contexto con preguntas de los números dados (`q{n}` como id). */
function ctx(...numbers: number[]) {
  return { questions: numbers.map((n) => ({ id: `q${n}`, number: n })) };
}

describe("computeRenumbering", () => {
  it("no toca nada si la numeración ya es continua", () => {
    const { updates, total } = computeRenumbering([ctx(1, 2, 3), ctx(4, 5)]);
    expect(updates).toEqual([]);
    expect(total).toBe(5);
  });

  it("compacta el hueco que deja una pregunta borrada", () => {
    // Se borró la 3 de [1,2,3,4,5]: las siguientes bajan uno.
    const { updates, total } = computeRenumbering([ctx(1, 2), ctx(4, 5)]);
    expect(updates).toEqual([
      { id: "q4", number: 3 },
      { id: "q5", number: 4 },
    ]);
    expect(total).toBe(4);
  });

  it("borrar la ÚLTIMA pregunta no reescribe ninguna otra", () => {
    // Caso típico y el más frecuente: no debe generar N updates inútiles.
    const { updates, total } = computeRenumbering([ctx(1, 2, 3), ctx(4)]);
    expect(updates).toEqual([]);
    expect(total).toBe(4);
  });

  it("borrar la PRIMERA renumera todas las demás", () => {
    const { updates, total } = computeRenumbering([ctx(2, 3), ctx(4)]);
    expect(updates).toEqual([
      { id: "q2", number: 1 },
      { id: "q3", number: 2 },
      { id: "q4", number: 3 },
    ]);
    expect(total).toBe(3);
  });

  it("renumera a través de contextos, no dentro de cada uno", () => {
    // Se borró el contexto del medio (tenía 3, 4): el tercero arranca en 3.
    const { updates, total } = computeRenumbering([ctx(1, 2), ctx(5, 6, 7)]);
    expect(updates).toEqual([
      { id: "q5", number: 3 },
      { id: "q6", number: 4 },
      { id: "q7", number: 5 },
    ]);
    expect(total).toBe(5);
  });

  it("respeta el orden de los contextos que recibe", () => {
    // El repositorio consulta con orderBy: { order: 'asc' }; aquí se
    // comprueba que la función numera en ese orden y no por el `number`
    // preexistente (si el contexto 1 tuviera números más altos, mandaría
    // igualmente su posición).
    const { updates } = computeRenumbering([ctx(10, 11), ctx(1, 2)]);
    expect(updates).toEqual([
      { id: "q10", number: 1 },
      { id: "q11", number: 2 },
      { id: "q1", number: 3 },
      { id: "q2", number: 4 },
    ]);
  });

  it("tolera contextos vacíos sin consumir números", () => {
    const { updates, total } = computeRenumbering([ctx(1), { questions: [] }, ctx(3)]);
    expect(updates).toEqual([{ id: "q3", number: 2 }]);
    expect(total).toBe(2);
  });

  it("una evaluación sin preguntas deja total en 0", () => {
    expect(computeRenumbering([])).toEqual({ updates: [], total: 0 });
    expect(computeRenumbering([{ questions: [] }])).toEqual({ updates: [], total: 0 });
  });
});
