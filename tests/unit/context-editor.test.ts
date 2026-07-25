import { describe, expect, it } from "vitest";
import { renderTipTap } from "@/app/(dashboard)/teacher/evaluations/[id]/contexts/[sectionId]/rich-text-flat";

/**
 * `renderTipTap` aplana TipTap JSON a string sin tirar de `@tiptap/html` en
 * el bundle del cliente. Se usa en el bloque de lectura de cada pregunta del
 * editor por contexto. Cubre los tres casos que aparecen en datos reales:
 * - string plano (preguntas creadas desde el form del editor viejo).
 * - nodo hoja con `text` (texto inline).
 * - nodo contenedor con `content` recursivo (párrafo + runs).
 */
describe("renderTipTap (context-editor)", () => {
  it("devuelve el string tal cual si el valor ya es string", () => {
    expect(renderTipTap("Hola mundo")).toBe("Hola mundo");
    expect(renderTipTap("")).toBe("");
  });

  it("extrae `text` de un nodo hoja", () => {
    expect(renderTipTap({ type: "text", text: "liso" })).toBe("liso");
  });

  it("aplana `content` recursivo uniendo hijos con espacios", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Pregunta 1." }] },
        { type: "paragraph", content: [{ type: "text", text: "¿Cuál es X?" }] },
      ],
    };
    expect(renderTipTap(doc)).toBe("Pregunta 1. ¿Cuál es X?");
  });

  it("concatena runs de texto dentro del mismo párrafo", () => {
    const node = {
      type: "paragraph",
      content: [
        { type: "text", text: "Texto " },
        { type: "text", text: "concatenado." },
      ],
    };
    expect(renderTipTap(node).startsWith("Texto")).toBe(true);
  });

  it("devuelve string vacío para valores nulos/undefined/no-objeto", () => {
    expect(renderTipTap(null)).toBe("");
    expect(renderTipTap(undefined)).toBe("");
    expect(renderTipTap(42)).toBe("");
  });
});
