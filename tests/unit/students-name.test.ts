import { describe, expect, it } from "vitest";
import { formatStudentFullName } from "@/modules/students/domain/student";

describe("formatStudentFullName", () => {
  it("concatena 4 campos en MAYÚSCULA estilo ICFES", () => {
    expect(
      formatStudentFullName({
        lastName1: "Pérez",
        lastName2: "García",
        firstName1: "Juan",
        firstName2: "Carlos",
      }),
    ).toBe("PÉREZ GARCÍA JUAN CARLOS");
  });

  it("acepta 3 campos (sin segundo nombre)", () => {
    expect(
      formatStudentFullName({
        lastName1: "Pérez",
        lastName2: "García",
        firstName1: "Ana",
        firstName2: "",
      }),
    ).toBe("PÉREZ GARCÍA ANA");
  });

  it("acepta solo apellido1 + nombre1 (caso real colombiano)", () => {
    expect(
      formatStudentFullName({
        lastName1: "Pérez",
        lastName2: "",
        firstName1: "Ana",
        firstName2: "",
      }),
    ).toBe("PÉREZ ANA");
  });

  it("omite partes con solo whitespace", () => {
    expect(
      formatStudentFullName({
        lastName1: "  Pérez  ",
        lastName2: "   ",
        firstName1: "Ana",
        firstName2: "\t",
      }),
    ).toBe("PÉREZ ANA");
  });

  it("devuelve string vacío si todo está vacío", () => {
    expect(
      formatStudentFullName({
        lastName1: "",
        lastName2: "",
        firstName1: "",
        firstName2: "",
      }),
    ).toBe("");
  });

  it("preserva tildes y eñes en MAYÚSCULA", () => {
    expect(
      formatStudentFullName({
        lastName1: "muñoz",
        lastName2: "ñoño",
        firstName1: "ána",
        firstName2: "maría",
      }),
    ).toBe("MUÑOZ ÑOÑO ÁNA MARÍA");
  });
});
