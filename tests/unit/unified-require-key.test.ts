import { describe, expect, it } from "vitest";
import { requireKey } from "@/app/(dashboard)/teacher/evaluations/[id]/unified/require-key";

describe("requireKey", () => {
  it("vacío total → pide al menos 2 opciones", () => {
    expect(requireKey({}, "A")).toEqual({
      ok: false,
      msg: "Define al menos 2 opciones de respuesta.",
    });
  });

  it("una sola opción rellena → pide al menos 2 opciones", () => {
    expect(requireKey({ A: "x", B: "" }, "A")).toEqual({
      ok: false,
      msg: "Define al menos 2 opciones de respuesta.",
    });
  });

  it("dos opciones rellenas pero clave vacía → FALTA DEFINIR LA CLAVE", () => {
    expect(requireKey({ A: "x", B: "y" }, "A")).toEqual({ ok: true });
    // variante: correcta está sobre una opción vacía
    expect(requireKey({ A: "x", B: "y" }, "C")).toEqual({
      ok: false,
      msg: "FALTA DEFINIR LA CLAVE.",
    });
  });

  it("dos opciones con clave correctamente marcada → ok", () => {
    expect(requireKey({ A: "x", B: "y" }, "B")).toEqual({ ok: true });
  });

  it("ignora whitespace puro en opciones", () => {
    expect(requireKey({ A: "   ", B: "y" }, "B")).toEqual({
      ok: false,
      msg: "Define al menos 2 opciones de respuesta.",
    });
  });
});
