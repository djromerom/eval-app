/**
 * Tests de `groupSectionsForPrint` y `isNingunoSection`.
 *
 * Caso de uso del sprint (Sep 2026, pedido del docente): cuando un docente
 * apila varias secciones "ninguno" consecutivas para cargar ítems sueltos
 * (matching + V/F en el mismo examen), el render por sección las marcaba
 * todas "high" (un ítem no se beneficia de 2-col) y desperdiciaba la mitad
 * de la página. El agrupador las aplana en un solo bloque `none-merged`
 * para que `computeGroupDensity` sume los ítems y active 2-col.
 *
 * Reglas que cubre este archivo:
 * - Sección con título → `single`, conservada en orden.
 * - Sección con contenido renderizable → `single`.
 * - Sección con `title: null` y `content: null` → "ninguno".
 * - Sección con `title: ""` → "ninguno" (string vacío tras `trim`).
 * - Sección con `<p></p>` vacío (lo que devuelve RichTextEditor al inicio) →
 *   "ninguno" (la guarda `richTextHasRenderableContent`).
 * - Sección "ninguno" solitaria → `single`, NO `none-merged` de 1.
 * - Run de N "ninguno" consecutivas → un solo `none-merged` con N secciones.
 * - Mixto: contexto con título, varios "ninguno", otro contexto → 3 grupos en
 *   el orden original (`single` + `none-merged` + `single`).
 * - Lista vacía → lista vacía.
 */
import { describe, expect, it } from "vitest";
import {
  groupSectionsForPrint,
  isNingunoSection,
} from "@/modules/printing/domain/section-grouping";
import type { EvaluationSection } from "@/modules/evaluations/domain/evaluation";

/** Documento TipTap de un párrafo con texto. */
const texto = (t: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
});

/** Documento TipTap de un párrafo vacío (lo que devuelve RichTextEditor recién creado). */
const parrafoVacio = () => ({ type: "doc", content: [{ type: "paragraph" }] });

/** Construye una sección mínima con overrides opcionales. */
function seccion(opts: {
  id: string;
  title?: string | null;
  content?: unknown;
}): EvaluationSection {
  return {
    id: opts.id,
    title: opts.title ?? null,
    content: opts.content ?? null,
    order: 0,
    columnLayoutOverride: null,
    questions: [],
  };
}

describe("isNingunoSection", () => {
  it("title: null + content: null → ninguno", () => {
    expect(isNingunoSection(seccion({ id: "s1" }))).toBe(true);
  });

  it("title con texto → no-ninguno", () => {
    expect(isNingunoSection(seccion({ id: "s1", title: "PARTE 1" }))).toBe(false);
  });

  it("title con solo espacios → no-ninguno (texto no vacío)", () => {
    // Trim en isNingunoSection solo recorta `title`; un whitespace suelto
    // cuenta como "con contexto" porque coincide con lo que el docente
    // ve en el editor. Si lo dejamos pasar como "ninguno" aparecerían
    // secciones con título a medias mezcladas con sus items siguientes.
    expect(isNingunoSection(seccion({ id: "s1", title: "   " }))).toBe(true);
  });

  it("title: '' → ninguno", () => {
    expect(isNingunoSection(seccion({ id: "s1", title: "" }))).toBe(true);
  });

  it("title: null + content con párrafo vacío → ninguno", () => {
    expect(isNingunoSection(seccion({ id: "s1", content: parrafoVacio() }))).toBe(true);
  });

  it("title: null + content con texto → no-ninguno", () => {
    expect(isNingunoSection(seccion({ id: "s1", content: texto("hola") }))).toBe(false);
  });

  it("title: 'Contexto' + content con párrafo vacío → no-ninguno (título manda)", () => {
    expect(
      isNingunoSection(seccion({ id: "s1", title: "Contexto", content: parrafoVacio() })),
    ).toBe(false);
  });
});

describe("groupSectionsForPrint", () => {
  it("lista vacía → []", () => {
    expect(groupSectionsForPrint([])).toEqual([]);
  });

  it("una sola sección 'ninguno' → single (no none-merged de 1)", () => {
    const s = seccion({ id: "s1" });
    const grupos = groupSectionsForPrint([s]);
    expect(grupos).toEqual([{ kind: "single", section: s }]);
  });

  it("una sola sección con título → single", () => {
    const s = seccion({ id: "s1", title: "PARTE 1" });
    const grupos = groupSectionsForPrint([s]);
    expect(grupos).toEqual([{ kind: "single", section: s }]);
  });

  it("dos 'ninguno' consecutivas → un none-merged con ambas", () => {
    const a = seccion({ id: "a" });
    const b = seccion({ id: "b" });
    const grupos = groupSectionsForPrint([a, b]);
    expect(grupos).toEqual([{ kind: "none-merged", sections: [a, b] }]);
  });

  it("cinco 'ninguno' consecutivas → un none-merged con las cinco (caso INGLÉS PARTE 1)", () => {
    const items = ["p1", "p2", "p3", "p4", "p5"].map((id) => seccion({ id }));
    const grupos = groupSectionsForPrint(items);
    expect(grupos).toEqual([{ kind: "none-merged", sections: items }]);
  });

  it("ninguno-con título-ninguno: 3 grupos en orden (single, none-merged, single)", () => {
    const intro = seccion({ id: "intro", title: "RESPONDA LAS PREGUNTAS 1 A 10" });
    const a = seccion({ id: "a" });
    const b = seccion({ id: "b" });
    const cierre = seccion({ id: "cierre", title: "LECTURA" });
    const grupos = groupSectionsForPrint([intro, a, b, cierre]);
    expect(grupos).toEqual([
      { kind: "single", section: intro },
      { kind: "none-merged", sections: [a, b] },
      { kind: "single", section: cierre },
    ]);
  });

  it("mezcla con secciones con contenido (no solo título) las separa", () => {
    const ctx = seccion({ id: "ctx", title: "TEXTO", content: texto("cuerpo") });
    const a = seccion({ id: "a" });
    const b = seccion({ id: "b" });
    const grupos = groupSectionsForPrint([ctx, a, b]);
    expect(grupos).toEqual([
      { kind: "single", section: ctx },
      { kind: "none-merged", sections: [a, b] },
    ]);
  });

  it("ninguno al principio → leading none-merged", () => {
    const a = seccion({ id: "a" });
    const b = seccion({ id: "b" });
    const cierre = seccion({ id: "cierre", title: "FIN" });
    const grupos = groupSectionsForPrint([a, b, cierre]);
    expect(grupos).toEqual([
      { kind: "none-merged", sections: [a, b] },
      { kind: "single", section: cierre },
    ]);
  });

  it("ninguno al final solitaria → trailing single (un ninguno suelto no se mergea)", () => {
    // Consistente con "dos 'ninguno' consecutivas → none-merged" + "una sola
    // sección 'ninguno' → single". El run necesita >=2 secciones para ser
    // none-merged; con 1 al final degenera a single.
    const intro = seccion({ id: "intro", title: "INICIO" });
    const a = seccion({ id: "a" });
    const grupos = groupSectionsForPrint([intro, a]);
    expect(grupos).toEqual([
      { kind: "single", section: intro },
      { kind: "single", section: a },
    ]);
  });

  it("ningunos NO consecutivos no se mergean aunque sean 'ninguno' ambos", () => {
    const a = seccion({ id: "a" });
    const intermedio = seccion({ id: "t", title: "T" });
    const b = seccion({ id: "b" });
    const grupos = groupSectionsForPrint([a, intermedio, b]);
    expect(grupos).toEqual([
      { kind: "single", section: a },
      { kind: "single", section: intermedio },
      { kind: "single", section: b },
    ]);
  });

  it("preserva el orden original tras múltiples runs", () => {
    const s1 = seccion({ id: "s1", title: "A" });
    const a = seccion({ id: "a" });
    const b = seccion({ id: "b" });
    const s2 = seccion({ id: "s2", title: "B" });
    const c = seccion({ id: "c" });
    const d = seccion({ id: "d" });
    const e = seccion({ id: "e" });
    const s3 = seccion({ id: "s3", title: "C" });
    const grupos = groupSectionsForPrint([s1, a, b, s2, c, d, e, s3]);
    expect(grupos).toEqual([
      { kind: "single", section: s1 },
      { kind: "none-merged", sections: [a, b] },
      { kind: "single", section: s2 },
      { kind: "none-merged", sections: [c, d, e] },
      { kind: "single", section: s3 },
    ]);
  });

  it("no muta el array de secciones original", () => {
    const a = seccion({ id: "a" });
    const b = seccion({ id: "b" });
    const original: EvaluationSection[] = [a, b];
    const snapshot = [...original];
    groupSectionsForPrint(original);
    expect(original).toEqual(snapshot);
  });
});
