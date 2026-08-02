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

/**
 * Simulación del orquestador de "Agregar enunciado" tal como está
 * implementado en `unified-editor.tsx > overrideAction`. El objetivo
 * de estos tests es reproducir el bug original ("sección duplicada tras
 * segundo Agregar enunciado") y validar que el fix `contextoMatchesSection`
 * + limpieza de drafts tras guardar cubre todos los caminos.
 *
 * El orquestador tiene esta estructura:
 *
 *   if (editing) return updateQuestionAction(formData);
 *   const unsaved = hasUnsavedContexto(draftTitle, draftContent);
 *   const targetSection = data.sections.find(s => s.id === targetSectionId);
 *   if (!unsaved || contextoMatchesSection(draftTitle, draftContent, targetSection)) {
 *     return addQuestionAction(formData);     // ← REUSA sección destino
 *   }
 *   // si NO coincide, decidir entre renombrar la vacía o crear nueva:
 *   const onlySection = data.sections.length === 1 ? data.sections[0] : null;
 *   const isEmpty = onlySection && !onlySection.title && !onlySection.content;
 *   if (isEmpty) {
 *     return updateSectionAction(onlySection.id, draftTitle, draftContent);
 *   } else {
 *     return addSectionAction(draftTitle, draftContent);
 *   }
 *   return addQuestionAction(formData);
 *
 * Para estos tests aislamos SOLO la decisión: ¿el orquestador cae en
 * "reusar" (camino rápido) o en "renombrar/crear" (camino lento)?
 */
type Decision = "reuse" | "rename-empty" | "create-new";

function decideOverride(
  sections: { id: string; title: string | null; content: unknown }[],
  targetSectionId: string | null,
  draftTitle: string,
  draftContent: unknown,
): { decision: Decision; sectionId: string | null } {
  const unsaved = hasUnsavedContexto(draftTitle, draftContent);
  const targetSection = sections.find((s) => s.id === targetSectionId) ?? null;
  if (!unsaved || contextoMatchesSection(draftTitle, draftContent, targetSection)) {
    return { decision: "reuse", sectionId: targetSectionId };
  }
  const onlySection: { id: string; title: string | null; content: unknown } | null =
    sections.length === 1 && sections[0] ? sections[0] : null;
  const isEmpty = onlySection !== null && !onlySection.title && !onlySection.content;
  if (isEmpty && onlySection) {
    return { decision: "rename-empty", sectionId: onlySection.id };
  }
  return { decision: "create-new", sectionId: null };
}

describe("decideOverride (flujo Agregar enunciado)", () => {
  // CASO 1: estado inicial — 1 sección vacía auto-creada.
  // Click 1: docente escribe "C1" y agrega enunciado.
  // Esperado: RENOMBRAR la vacía (no crear nueva).
  it("Click 1: sección vacía + draft 'C1' → rename-empty", () => {
    const sections = [{ id: "sec-empty", title: null, content: null }];
    const r = decideOverride(sections, "sec-empty", "C1", null);
    expect(r.decision).toBe("rename-empty");
    expect(r.sectionId).toBe("sec-empty");
  });

  // CASO 2: tras rename, sección persistida con title="C1".
  // Click 2: docente deja "C1" y agrega enunciado.
  // Esperado: REUSAR (la pregunta va a la misma sección).
  it("Click 2: sección 'C1' + draft 'C1' (mismo) → reuse", () => {
    const sections = [{ id: "sec-c1", title: "C1", content: null }];
    const r = decideOverride(sections, "sec-c1", "C1", null);
    expect(r.decision).toBe("reuse");
    expect(r.sectionId).toBe("sec-c1");
  });

  // CASO 3: tras rename, docente cambia el título a "C2" y agrega.
  // Esperado: CREAR NUEVA sección.
  it("Click 3: sección 'C1' + draft 'C2' (cambió) → create-new", () => {
    const sections = [{ id: "sec-c1", title: "C1", content: null }];
    const r = decideOverride(sections, "sec-c1", "C2", null);
    expect(r.decision).toBe("create-new");
  });

  // CASO 4 (BUG ORIGINAL): tras rename a "C1" + addQuestion, el docente
  // vuelve a hacer click en "Agregar enunciado" sin tocar nada.
  // El draft SIGUE teniendo "C1" (no se limpia tras onDone).
  // Esperado: REUSAR.
  it("Click 4 (bug): drafts stale con 'C1' + sección 'C1' → reuse", () => {
    const sections = [{ id: "sec-c1", title: "C1", content: null }];
    // Simula el estado tras el onDone del primer click: drafts NO se
    // limpiaron, siguen con "C1".
    const r = decideOverride(sections, "sec-c1", "C1", null);
    expect(r.decision).toBe("reuse");
    expect(r.sectionId).toBe("sec-c1");
  });

  // CASO 5: 2 secciones. targetSectionId apunta a la última ("C2").
  // Docente deja "C2" precargado y click.
  // Esperado: REUSAR sec-c2.
  it("2 secciones + target=c2 + draft 'C2' → reuse sec-c2", () => {
    const sections = [
      { id: "sec-c1", title: "C1", content: null },
      { id: "sec-c2", title: "C2", content: null },
    ];
    const r = decideOverride(sections, "sec-c2", "C2", null);
    expect(r.decision).toBe("reuse");
    expect(r.sectionId).toBe("sec-c2");
  });

  // CASO 6: 2 secciones. targetSectionId apunta a sec-c1 (vieja).
  // Docente agrega "C3" (nuevo contexto).
  // Esperado: CREAR NUEVA sección (no renombrar sec-c1).
  it("2 secciones + target=c1 + draft 'C3' (nuevo) → create-new", () => {
    const sections = [
      { id: "sec-c1", title: "C1", content: null },
      { id: "sec-c2", title: "C2", content: null },
    ];
    const r = decideOverride(sections, "sec-c1", "C3", null);
    expect(r.decision).toBe("create-new");
  });

  // CASO 7 (EDGE): 2 secciones. targetSectionId apunta a sec-c1.
  // Docente deja "C1" precargado (NO cambió) y click.
  // Esperado: REUSAR sec-c1 (la pregunta va a la sección del contexto
  // visible). PERO podría argumentarse que debería ir a la última
  // sección (sec-c2). Decisión actual: reusa sec-c1 porque coincide
  // con el contexto que el docente ve en pantalla.
  it("2 secciones + target=c1 + draft 'C1' (sin cambios) → reuse sec-c1", () => {
    const sections = [
      { id: "sec-c1", title: "C1", content: null },
      { id: "sec-c2", title: "C2", content: null },
    ];
    const r = decideOverride(sections, "sec-c1", "C1", null);
    expect(r.decision).toBe("reuse");
    expect(r.sectionId).toBe("sec-c1");
  });

  // CASO 8: estado inicial sin secciones (todas borradas o evaluación
  // recién creada sin auto-creación). targetSectionId=null.
  // Docente escribe "C1".
  // Esperado: CREAR NUEVA sección.
  it("0 secciones + draft 'C1' → create-new (no hay dónde reusar)", () => {
    const r = decideOverride([], null, "C1", null);
    expect(r.decision).toBe("create-new");
  });

  // CASO 9 (EDGE CRÍTICO): sección con content (no solo title).
  // Docente solo tiene el content, sin cambiar título.
  // Esperado: REUSAR si content coincide.
  it("sección con content + draft con mismo content → reuse", () => {
    const c = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Cuerpo" }] }],
    };
    const sections = [{ id: "sec-c1", title: null, content: c }];
    const r = decideOverride(sections, "sec-c1", "", c);
    expect(r.decision).toBe("reuse");
    expect(r.sectionId).toBe("sec-c1");
  });
});
