import { describe, expect, it } from "vitest";
import {
  contextoMatchesSection,
  hasUnsavedContexto,
} from "@/app/(dashboard)/teacher/evaluations/[id]/unified/save-contexto";

describe("hasUnsavedContexto", () => {
  it("title con texto → unsaved", () => {
    expect(hasUnsavedContexto("Lectura 1", null)).toBe(true);
    expect(hasUnsavedContexto("  Lectura 1  ", null)).toBe(true);
  });

  it("title vacío o whitespace + content null → NOT unsaved", () => {
    expect(hasUnsavedContexto("", null)).toBe(false);
    expect(hasUnsavedContexto("   ", null)).toBe(false);
    expect(hasUnsavedContexto(undefined, null)).toBe(false);
  });

  it("content con texto real → unsaved", () => {
    expect(
      hasUnsavedContexto(null, {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Hola" }] }],
      }),
    ).toBe(true);
  });

  it("content EMPTY_DOC (sin texto) → NOT unsaved", () => {
    expect(hasUnsavedContexto(null, { type: "doc", content: [{ type: "paragraph" }] })).toBe(false);
    expect(
      hasUnsavedContexto(null, {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }],
      }),
    ).toBe(false);
    expect(
      hasUnsavedContexto(null, {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "   \n  " }] }],
      }),
    ).toBe(false);
  });

  it("content vacío o primitivo → NOT unsaved", () => {
    expect(hasUnsavedContexto(null, null)).toBe(false);
    expect(hasUnsavedContexto(null, undefined)).toBe(false);
    expect(hasUnsavedContexto(null, "")).toBe(false);
    expect(hasUnsavedContexto(null, "string suelto")).toBe(false);
    expect(hasUnsavedContexto(null, 42)).toBe(false);
    expect(hasUnsavedContexto(null, {})).toBe(false);
  });

  it("content con múltiples párrafos, alguno con texto → unsaved", () => {
    expect(
      hasUnsavedContexto(null, {
        type: "doc",
        content: [
          { type: "paragraph" },
          { type: "paragraph", content: [{ type: "text", text: "Real" }] },
        ],
      }),
    ).toBe(true);
  });

  it("title vacío + content con texto → unsaved (caso del bug original)", () => {
    // El docente escribe solo el contenido sin título: queremos guardar
    // la sección con título null pero con el cuerpo.
    expect(
      hasUnsavedContexto("", {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Cuerpo" }] }],
      }),
    ).toBe(true);
  });
});

describe("contextoMatchesSection", () => {
  it("sección null/undefined → no coincide (no hay nada que reusar)", () => {
    expect(contextoMatchesSection("", null, null)).toBe(false);
    expect(contextoMatchesSection("", null, undefined)).toBe(false);
  });

  it("ambos vacíos (sección vacía + draft vacío) → coincide", () => {
    expect(contextoMatchesSection("", null, { title: null, content: null })).toBe(true);
    expect(
      contextoMatchesSection(
        "",
        { type: "doc", content: [{ type: "paragraph" }] },
        {
          title: null,
          content: null,
        },
      ),
    ).toBe(true);
  });

  it("título idéntico → coincide (caso del bug actual: 2ª pregunta con draft stale)", () => {
    expect(contextoMatchesSection("Contexto A", null, { title: "Contexto A", content: null })).toBe(
      true,
    );
    expect(
      contextoMatchesSection("  Contexto A  ", null, { title: "Contexto A", content: null }),
    ).toBe(true);
  });

  it("títulos distintos → NO coincide (hay que crear sección nueva)", () => {
    expect(contextoMatchesSection("Contexto B", null, { title: "Contexto A", content: null })).toBe(
      false,
    );
  });

  it("sección vacía + draft con texto → NO coincide (renombrar la vacía)", () => {
    expect(contextoMatchesSection("Contexto A", null, { title: null, content: null })).toBe(false);
  });

  it("sección con texto + draft vacío → NO coincide (no debería pasar en UI)", () => {
    expect(contextoMatchesSection("", null, { title: "Contexto A", content: null })).toBe(false);
  });
});
