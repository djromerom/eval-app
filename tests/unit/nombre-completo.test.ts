import { describe, expect, it } from "vitest";
import { nombreCompleto } from "@/modules/students/domain/nombre-completo";

const base = { lastName1: "", lastName2: "", firstName1: "", firstName2: "" };

describe("nombreCompleto", () => {
  it("arma APELLIDOS, NOMBRES", () => {
    expect(
      nombreCompleto({
        lastName1: "GOMEZ",
        lastName2: "REINOSO",
        firstName1: "JESUS",
        firstName2: "DAVID",
      }),
    ).toBe("GOMEZ REINOSO, JESUS DAVID");
  });

  it("omite los campos opcionales vacíos, sin dobles espacios", () => {
    expect(nombreCompleto({ ...base, lastName1: "GOMEZ", firstName1: "JESUS" })).toBe(
      "GOMEZ, JESUS",
    );
  });

  it("sin nombres no deja una coma suelta", () => {
    expect(nombreCompleto({ ...base, lastName1: "GOMEZ" })).toBe("GOMEZ");
  });

  it("sin apellidos tampoco", () => {
    expect(nombreCompleto({ ...base, firstName1: "JESUS" })).toBe("JESUS");
  });

  it("todo vacío devuelve cadena vacía, no ', '", () => {
    // El llamador decide qué mostrar en ese caso; lo que no puede es recibir
    // basura de puntuación.
    expect(nombreCompleto(base)).toBe("");
  });
});
