import { describe, expect, it } from "vitest";
import { listPositionByName } from "@/modules/students/domain/student";

describe("listPositionByName", () => {
  const curso = [
    { id: "a", lastName1: "AGUILAR", lastName2: "", firstName1: "Ana", firstName2: "" },
    { id: "b", lastName1: "AGUILAR", lastName2: "RUIZ", firstName1: "Beto", firstName2: "" },
    { id: "c", lastName1: "AGUILAR", lastName2: "RUIZ", firstName1: "Beto", firstName2: "Camilo" },
    { id: "d", lastName1: "PÉREZ", lastName2: "", firstName1: "Diana", firstName2: "" },
    { id: "e", lastName1: "PÉREZ", lastName2: "GARCÍA", firstName1: "Juan", firstName2: "" },
    { id: "f", lastName1: "PÉREZ", lastName2: "GARCÍA", firstName1: "Juan", firstName2: "Carlos" },
    { id: "g", lastName1: "ZAMORA", lastName2: "", firstName1: "Luz", firstName2: "" },
  ];

  it("ordena por apellido1 → apellido2 → nombre1 → nombre2 con collation es", () => {
    // PÉREZ GARCÍA JUAN CARLOS es el 6°: apellido2='GARCÍA' > '' (D PÉREZ)
    // y firstName2='Carlos' > '' (E PÉREZ GARCÍA JUAN).
    expect(listPositionByName(curso, "f")).toBe(6);
    expect(listPositionByName(curso, "e")).toBe(5);
  });

  it("devuelve 1 para el primero de la lista", () => {
    expect(listPositionByName(curso, "a")).toBe(1);
  });

  it("devuelve el último para el último de la lista", () => {
    expect(listPositionByName(curso, "g")).toBe(7);
  });

  it("desempata por id cuando las 4 partes son idénticas", () => {
    // 'b' y 'c' comparten las 4 partes excepto firstName2; pero acá probamos
    // un empate total artificial con dos ids distintos.
    const empatados = [
      { id: "x", lastName1: "ROJAS", lastName2: "", firstName1: "A", firstName2: "" },
      { id: "y", lastName1: "ROJAS", lastName2: "", firstName1: "A", firstName2: "" },
    ];
    expect(listPositionByName(empatados, "x")).toBe(1);
    expect(listPositionByName(empatados, "y")).toBe(2);
  });

  it("el orden de entrada no afecta la posición (orden estable)", () => {
    // Misma lista, distinto orden de entrada: las posiciones no cambian.
    const desorden = ["g", "f", "a", "d", "e", "c", "b"].map((id) =>
      curso.find((s) => s.id === id)!,
    );
    expect(listPositionByName(desorden, "f")).toBe(6);
    expect(listPositionByName(desorden, "e")).toBe(5);
  });

  it("devuelve null cuando el id no está en la lista", () => {
    expect(listPositionByName(curso, "no-existe")).toBeNull();
  });

  it("devuelve null con lista vacía", () => {
    expect(listPositionByName([], "cualquiera")).toBeNull();
  });

  it("no muta el array de entrada", () => {
    const original = [...curso];
    listPositionByName(curso, "f");
    expect(curso).toEqual(original);
  });
});