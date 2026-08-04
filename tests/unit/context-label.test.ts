import { describe, expect, it } from "vitest";
import {
  contextLabel,
  type SectionLite,
} from "@/app/(dashboard)/teacher/evaluations/[id]/unified/context-label";

const sections: SectionLite[] = [
  {
    id: "sec-empty",
    title: null,
    content: null,
    questions: [{ id: "q-empty" }],
  },
  {
    id: "sec-titled",
    title: "Contexto A",
    content: { type: "doc", content: [{ type: "paragraph" }] },
    questions: [{ id: "q-titled-1" }],
  },
  {
    id: "sec-shared",
    title: "Contexto compartido",
    content: { type: "doc", content: [{ type: "paragraph" }] },
    questions: [{ id: "q-shared-1" }, { id: "q-shared-2" }, { id: "q-shared-3" }],
  },
  {
    id: "sec-long",
    title:
      "Para resolver un sistema de ecuaciones lineales se emplean diversos métodos, entre ellos el método de igualación, sustitución y reducción, cada uno con sus propias ventajas y desventajas dependiendo del tipo de sistema al que se aplique.",
    content: { type: "doc", content: [{ type: "paragraph" }] },
    questions: [{ id: "q-long-1" }, { id: "q-long-2" }],
  },
];

describe("contextLabel", () => {
  it('sección inexistente → "Ninguno"', () => {
    expect(contextLabel({ id: "q-orphan", sectionId: "no-existe" }, sections)).toEqual({
      kind: "Ninguno",
      title: null,
      truncated: false,
    });
  });

  it('sección sin título ni contenido → "Ninguno"', () => {
    expect(contextLabel({ id: "q-empty", sectionId: "sec-empty" }, sections)).toEqual({
      kind: "Ninguno",
      title: null,
      truncated: false,
    });
  });

  it('sección con título propio y 1 pregunta → "Especifico"', () => {
    expect(contextLabel({ id: "q-titled-1", sectionId: "sec-titled" }, sections)).toEqual({
      kind: "Especifico",
      title: "Contexto A",
      truncated: false,
    });
  });

  it('sección con título propio pero varias preguntas (compartido) → "Comun"', () => {
    expect(contextLabel({ id: "q-shared-1", sectionId: "sec-shared" }, sections)).toEqual({
      kind: "Comun",
      title: "Contexto compartido",
      truncated: false,
    });
    expect(contextLabel({ id: "q-shared-3", sectionId: "sec-shared" }, sections)).toEqual({
      kind: "Comun",
      title: "Contexto compartido",
      truncated: false,
    });
  });

  it("título largo se trunca con elipsis en límite de palabra y marca truncated=true", () => {
    const result = contextLabel({ id: "q-long-1", sectionId: "sec-long" }, sections, 40);
    expect(result.kind).toBe("Comun");
    expect(result.title).toBe("Para resolver un sistema de ecuaciones…");
    expect(result.truncated).toBe(true);
  });

  it("título más corto que el límite no se trunca", () => {
    const result = contextLabel({ id: "q-titled-1", sectionId: "sec-titled" }, sections, 50);
    expect(result.title).toBe("Contexto A");
    expect(result.truncated).toBe(false);
  });

  it("sección sin título devuelve title=null", () => {
    const result = contextLabel({ id: "q-empty", sectionId: "sec-empty" }, sections);
    expect(result.title).toBeNull();
    expect(result.truncated).toBe(false);
  });

  it('sección con contenido pero SIN título → "Ninguno" (no cuenta como contexto)', () => {
    const anonSections: SectionLite[] = [
      {
        id: "sec-anon",
        title: null,
        content: { type: "doc", content: [{ type: "paragraph" }] },
        questions: [{ id: "q-anon-1" }],
      },
    ];
    const result = contextLabel({ id: "q-anon-1", sectionId: "sec-anon" }, anonSections);
    expect(result.kind).toBe("Ninguno");
    expect(result.title).toBeNull();
  });
});
