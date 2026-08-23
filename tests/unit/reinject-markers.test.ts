/**
 * Tests del helper cliente `reInjectMarkers`.
 * ============================================
 *
 * Cubre:
 *   • Anota cada componente studio-* con `data-studio-block` correcto.
 *   • Idempotente: si ya tiene el atributo, no lo duplica.
 *   • Corrige valores incorrectos.
 *   • Reporta `unknown` para tipos studio-* sin mapping (defensa).
 *   • Recorre recursivamente el árbol (componentes hijos).
 *   • Lanza TypeError si el input no tiene la forma esperada.
 */
import { describe, expect, it } from "vitest";
import {
  reInjectMarkers,
  STUDIO_TYPE_TO_BLOCK_ID,
} from "@/app/(dashboard)/admin/bundles/[id]/cover-visual/reinject-markers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStudioComponent(type: string, attributes?: Record<string, unknown>) {
  return {
    type,
    attributes: attributes ?? {},
    components: [],
  };
}

function makeProjectWithFrames(frames: Array<{ component: unknown }>) {
  return {
    pages: [{ id: "p1", frames: frames.map((f, i) => ({ id: `f${i}`, component: f.component })) }],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("reInjectMarkers", () => {
  it("añade `data-studio-block` a un componente studio-callout", () => {
    const project = makeProjectWithFrames([{ component: makeStudioComponent("studio-callout") }]);
    const report = reInjectMarkers(project);

    expect(report.added).toBe(1);
    expect(report.corrected).toBe(0);
    expect(report.unknown).toBe(0);
    const comp = project.pages[0]!.frames[0]!.component as { attributes: Record<string, unknown> };
    expect(comp.attributes["data-studio-block"]).toBe("callout");
  });

  it("anota los 6 studio types con sus block ids correctos", () => {
    const project = makeProjectWithFrames([
      { component: makeStudioComponent("studio-callout") },
      { component: makeStudioComponent("studio-how-to-mark") },
      { component: makeStudioComponent("studio-items-before") },
      { component: makeStudioComponent("studio-items-after") },
      { component: makeStudioComponent("studio-prohibited") },
      { component: makeStudioComponent("studio-legal-footer") },
    ]);
    const report = reInjectMarkers(project);

    expect(report.added).toBe(6);
    const frames = project.pages[0]!.frames;
    expect(
      (frames[0]!.component as { attributes: Record<string, unknown> }).attributes[
        "data-studio-block"
      ],
    ).toBe("callout");
    expect(
      (frames[1]!.component as { attributes: Record<string, unknown> }).attributes[
        "data-studio-block"
      ],
    ).toBe("howToMark");
    expect(
      (frames[2]!.component as { attributes: Record<string, unknown> }).attributes[
        "data-studio-block"
      ],
    ).toBe("itemsBefore");
    expect(
      (frames[3]!.component as { attributes: Record<string, unknown> }).attributes[
        "data-studio-block"
      ],
    ).toBe("itemsAfter");
    expect(
      (frames[4]!.component as { attributes: Record<string, unknown> }).attributes[
        "data-studio-block"
      ],
    ).toBe("prohibited");
    expect(
      (frames[5]!.component as { attributes: Record<string, unknown> }).attributes[
        "data-studio-block"
      ],
    ).toBe("legalFooter");
  });

  it("ignora componentes genéricos (no añade atributo)", () => {
    const project = makeProjectWithFrames([
      { component: makeStudioComponent("text") },
      { component: makeStudioComponent("image") },
      { component: makeStudioComponent("divider") },
      { component: makeStudioComponent("two-column") },
    ]);
    const report = reInjectMarkers(project);

    expect(report.added).toBe(0);
    expect(report.unknown).toBe(0);
  });

  it("idempotente: si el atributo ya está correcto, no lo duplica ni lo modifica", () => {
    const project = makeProjectWithFrames([
      {
        component: makeStudioComponent("studio-callout", {
          "data-studio-block": "callout",
        }),
      },
    ]);
    const report = reInjectMarkers(project);

    expect(report.added).toBe(0);
    expect(report.corrected).toBe(0);
  });

  it("corrige un valor incorrecto del atributo", () => {
    const project = makeProjectWithFrames([
      {
        component: makeStudioComponent("studio-callout", {
          "data-studio-block": "wrong-value",
        }),
      },
    ]);
    const report = reInjectMarkers(project);

    expect(report.added).toBe(0);
    expect(report.corrected).toBe(1);
    const comp = project.pages[0]!.frames[0]!.component as { attributes: Record<string, unknown> };
    expect(comp.attributes["data-studio-block"]).toBe("callout");
  });

  it("recorre recursivamente los componentes hijos", () => {
    const nested = {
      pages: [
        {
          id: "p1",
          frames: [
            {
              id: "f1",
              component: {
                type: "two-column",
                components: [
                  makeStudioComponent("studio-callout"),
                  {
                    type: "text",
                    components: [makeStudioComponent("studio-prohibited")],
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const report = reInjectMarkers(nested);

    // 2 studio components encontrados (callout y prohibited)
    expect(report.added).toBe(2);

    const frame = nested.pages[0]!.frames[0]!.component;
    const firstChild = (frame as { components: Array<{ attributes: Record<string, unknown> }> })
      .components[0]!;
    const nestedText = (
      frame as { components: Array<{ components: Array<{ attributes: Record<string, unknown> }> }> }
    ).components[1]!;
    expect(firstChild.attributes["data-studio-block"]).toBe("callout");
    expect(nestedText.components[0]!.attributes["data-studio-block"]).toBe("prohibited");
  });

  it("reporte `unknown` si aparece un studio-* sin mapping", () => {
    // Forzamos el caso defensivo: el tipo `studio-future` no está en el mapa.
    const project = makeProjectWithFrames([
      { component: makeStudioComponent("studio-future-feature") },
    ]);
    const report = reInjectMarkers(project);

    expect(report.unknown).toBe(1);
    expect(report.added).toBe(0);
  });

  it("STUDIO_TYPE_TO_BLOCK_ID cubre los 6 ids del Cover Studio", () => {
    const ids = Object.values(STUDIO_TYPE_TO_BLOCK_ID).sort();
    expect(ids).toEqual([
      "callout",
      "howToMark",
      "itemsAfter",
      "itemsBefore",
      "legalFooter",
      "prohibited",
    ]);
  });

  // ----- Errores -------------------------------------------------------------

  it("lanza TypeError si el proyecto no es un objeto", () => {
    expect(() => reInjectMarkers("string")).toThrow(TypeError);
    expect(() => reInjectMarkers(null)).toThrow(TypeError);
    expect(() => reInjectMarkers(42)).toThrow(TypeError);
  });

  it("lanza TypeError si el proyecto no tiene `pages` array", () => {
    expect(() => reInjectMarkers({})).toThrow(TypeError);
    expect(() => reInjectMarkers({ pages: "not-array" })).toThrow(TypeError);
  });

  it("no falla si una página no tiene frames", () => {
    const project = { pages: [{ id: "p1" }] };
    expect(() => reInjectMarkers(project)).not.toThrow();
    const report = reInjectMarkers(project);
    expect(report.added).toBe(0);
  });

  it("no falla si un frame no tiene component", () => {
    const project = { pages: [{ id: "p1", frames: [{ id: "f1" }] }] };
    expect(() => reInjectMarkers(project)).not.toThrow();
  });
});
