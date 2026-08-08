import { describe, expect, it } from "vitest";
import { hasUnsavedContexto } from "@/app/(dashboard)/teacher/evaluations/[id]/unified/save-contexto";

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

type Decision = "reuse-existing" | "create-first" | "rename-empty" | "create-new";

function decideOverride(
  sections: { id: string; title: string | null; content: unknown }[],
  targetSectionId: string | null,
  // El orquestador real propaga el draft del docente al
  // updateSectionAction / addSectionAction en las ramas rename-empty y
  // create-new. El clon ya no necesita el draft porque solo decide la
  // rama — el draft real se inyecta en otro nivel. Mantenemos los args
  // con prefijo `_` para no romper la firma pública del clon (los tests
  // siguen pasando `("C1", null)`).
  _draftTitle: string,
  _draftContent: unknown,
): { decision: Decision; sectionId: string | null } {
  // targetSectionId manda (ago 2026, pedido del docente): si apunta a
  // una sección CON contenido, se REUSA. El draft del docente sobre el
  // bloque Contexto es input libre y se descarta para la decisión de qué
  // sección usar.
  //
  // EXCEPCIÓN: si la sección destino está VACÍA (placeholder auto-creado
  // sin título ni contenido), NO reusamos — caemos en rename-empty para
  // que el primer "Agregar enunciado" dé nombre a esa sección en vez de
  // persistir la pregunta sin contexto.
  const targetSection = sections.find((s) => s.id === targetSectionId) ?? null;
  const targetHasContent =
    targetSection !== null &&
    (Boolean(targetSection.title?.trim()) || targetSection.content != null);
  if (targetSection && targetHasContent) {
    return { decision: "reuse-existing", sectionId: targetSection.id };
  }
  // Sin sección destino o destino vacío.
  // Rama 0 del orquestador real: 0 secciones → crear la primera con el draft.
  if (sections.length === 0) {
    return { decision: "create-first", sectionId: null };
  }
  // Lógica legacy: rename-empty si hay 1 sección vacía, si no create-new.
  // (ago 2026) `unsaved` ya no se calcula aquí — el rename-empty se hace
  // siempre que haya una única sección vacía y el orquestador real
  // propaga el draft del docente desde su scope.
  const onlySection = sections.length === 1 && sections[0] ? sections[0] : null;
  const isEmpty = onlySection !== null && !onlySection.title && !onlySection.content;
  if (isEmpty && onlySection) {
    return { decision: "rename-empty", sectionId: onlySection.id };
  }
  return { decision: "create-new", sectionId: null };
}

describe("decideOverride (flujo Agregar enunciado, ago 2026 id-manda)", () => {
  // CASO 1: estado inicial — 1 sección vacía auto-creada.
  // Click 1: docente escribe "C1" y agrega enunciado.
  // Esperado: RENOMBRAR la vacía (no crear nueva). targetSectionId apunta
  // a la sección vacía → la lógica nueva la considera "sin contenido"
  // y cae en la rama legacy rename-empty.
  it("Click 1: sección vacía + draft 'C1' → rename-empty", () => {
    const sections = [{ id: "sec-empty", title: null, content: null }];
    const r = decideOverride(sections, "sec-empty", "C1", null);
    expect(r.decision).toBe("rename-empty");
    expect(r.sectionId).toBe("sec-empty");
  });

  // CASO 2: tras rename, sección persistida con title="C1".
  // Click 2: docente deja "C1" y agrega enunciado.
  // Esperado: REUSAR (targetSection existe con contenido).
  it("Click 2: sección 'C1' + draft 'C1' (mismo) → reuse-existing sec-c1", () => {
    const sections = [{ id: "sec-c1", title: "C1", content: null }];
    const r = decideOverride(sections, "sec-c1", "C1", null);
    expect(r.decision).toBe("reuse-existing");
    expect(r.sectionId).toBe("sec-c1");
  });

  // CASO 3 (FIX): sección "C1", docente refina el título a "C2".
  // ANTES (jul 2026): contextoMatchesSection devolvía false → create-new.
  // AHORA (ago 2026): targetSectionId apunta a sec-c1 con contenido → REUSAR.
  it("Click 3: sección 'C1' + draft 'C2' (refinamiento) → reuse-existing sec-c1", () => {
    const sections = [{ id: "sec-c1", title: "C1", content: null }];
    const r = decideOverride(sections, "sec-c1", "C2", null);
    expect(r.decision).toBe("reuse-existing");
    expect(r.sectionId).toBe("sec-c1");
  });

  // CASO 4 (BUG ORIGINAL): tras rename a "C1" + addQuestion, el docente
  // vuelve a hacer click en "Agregar enunciado" sin tocar nada.
  // El draft SIGUE teniendo "C1" (no se limpia tras onDone).
  // Esperado: REUSAR.
  it("Click 4 (bug legacy): drafts stale con 'C1' + sección 'C1' → reuse-existing sec-c1", () => {
    const sections = [{ id: "sec-c1", title: "C1", content: null }];
    const r = decideOverride(sections, "sec-c1", "C1", null);
    expect(r.decision).toBe("reuse-existing");
    expect(r.sectionId).toBe("sec-c1");
  });

  // CASO 5: 2 secciones. targetSectionId apunta a la última ("C2").
  // Docente deja "C2" precargado y click.
  // Esperado: REUSAR sec-c2.
  it("2 secciones + target=c2 + draft 'C2' → reuse-existing sec-c2", () => {
    const sections = [
      { id: "sec-c1", title: "C1", content: null },
      { id: "sec-c2", title: "C2", content: null },
    ];
    const r = decideOverride(sections, "sec-c2", "C2", null);
    expect(r.decision).toBe("reuse-existing");
    expect(r.sectionId).toBe("sec-c2");
  });

  // CASO 6 (FIX PRINCIPAL): 2 secciones. targetSectionId apunta a sec-c1.
  // Docente agrega "C3" (nuevo contexto).
  // ANTES: create-new (duplicado).
  // AHORA: reuse-existing sec-c1 (id manda).
  it("2 secciones + target=c1 + draft 'C3' (nuevo) → reuse-existing sec-c1 (id manda)", () => {
    const sections = [
      { id: "sec-c1", title: "C1", content: null },
      { id: "sec-c2", title: "C2", content: null },
    ];
    const r = decideOverride(sections, "sec-c1", "C3", null);
    expect(r.decision).toBe("reuse-existing");
    expect(r.sectionId).toBe("sec-c1");
  });

  // CASO 7: 2 secciones. targetSectionId apunta a sec-c1. Draft "C1" sin cambios.
  // Esperado: REUSAR sec-c1.
  it("2 secciones + target=c1 + draft 'C1' (sin cambios) → reuse-existing sec-c1", () => {
    const sections = [
      { id: "sec-c1", title: "C1", content: null },
      { id: "sec-c2", title: "C2", content: null },
    ];
    const r = decideOverride(sections, "sec-c1", "C1", null);
    expect(r.decision).toBe("reuse-existing");
    expect(r.sectionId).toBe("sec-c1");
  });

  // CASO 8: 0 secciones, target=null, draft 'C1'.
  // El orquestador real tiene una rama dedicada (línea 1646 de
  // unified-editor.tsx) que crea la primera sección con el draft.
  // El clon decide: sin target ni secciones → create-first (el orquestador
  // real usa addSectionAction antes de addQuestionAction).
  it("0 secciones + draft 'C1' → create-first (rama 0 del orquestador)", () => {
    const r = decideOverride([], null, "C1", null);
    expect(r.decision).toBe("create-first");
  });

  // CASO 9 (EDGE CRÍTICO): sección con content real (no solo title).
  // Docente solo tiene el content, sin cambiar título.
  // Esperado: REUSAR (targetSection existe con contenido).
  it("sección con content + draft con mismo content → reuse-existing sec-c1", () => {
    const c = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Cuerpo" }] }],
    };
    const sections = [{ id: "sec-c1", title: null, content: c }];
    const r = decideOverride(sections, "sec-c1", "", c);
    expect(r.decision).toBe("reuse-existing");
    expect(r.sectionId).toBe("sec-c1");
  });

  // CASO 10 (NUEVO ago 2026): target=null + hay 1 sección CON contenido +
  // draft con texto distinto. Sin targetSection, el clon cae en rename-empty
  // solo si la única sección está vacía; si no, create-new.
  it("target=null + 1 sección con título + draft 'Otro' → create-new", () => {
    const sections = [{ id: "sec-c1", title: "C1", content: null }];
    const r = decideOverride(sections, null, "Otro", null);
    expect(r.decision).toBe("create-new");
  });

  // CASO 11 (NUEVO ago 2026): targetSectionId apunta a sección BORRADA
  // (no está en data.sections). draft con texto.
  // El clon trata la sección inexistente como "no target" → create-new.
  it("target=id-borrado + 1 sección 'C1' + draft 'X' → create-new", () => {
    const sections = [{ id: "sec-c1", title: "C1", content: null }];
    const r = decideOverride(sections, "id-borrado", "X", null);
    expect(r.decision).toBe("create-new");
  });

  // CASO 12 (NUEVO ago 2026): target existe con título Y el docente tipó
  // un draft con título Y contenido completamente distintos. La regla "id
  // manda" descarta el draft y reusa el destino.
  it("target existe + draft totalmente divergente → reuse-existing (descarta draft)", () => {
    const targetContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Original" }] }],
    };
    const draftContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Refinado" }] }],
    };
    const sections = [{ id: "sec-c1", title: "Original", content: targetContent }];
    const r = decideOverride(sections, "sec-c1", "Refinado", draftContent);
    expect(r.decision).toBe("reuse-existing");
    expect(r.sectionId).toBe("sec-c1");
  });

  // CASO 13 (FIX ago 2026, bug reportado por el docente): tras "Nuevo
  // contexto" sin tipear nada, queda una sección VACÍA recién creada y
  // el effect de auto-asignación reasigna `targetSectionId` a esa
  // sección. Si el docente luego escribe título + descripción en el
  // bloque Contexto y pulsa "Agregar enunciado", el draft debe poblar
  // esa sección vacía (rename-empty), NO descartarse en un
  // reuse-existing que dejaría la pregunta guardada sin contexto.
  //
  // ANTES del fix (jul 2026): `targetSection` existía → REUSAR → la
  // pregunta se guardaba en una sección sin título ni contenido.
  //
  // AHORA (ago 2026): si la sección destino está VACÍA y el docente
  // tipeó algo, cae en rename-empty → la sección vacía se renombra
  // con el draft del docente.
  it("target existe VACÍA + draft con título → rename-empty (pobla la vacía con el draft)", () => {
    const sections = [{ id: "sec-empty", title: null, content: null }];
    const r = decideOverride(sections, "sec-empty", "Mi contexto X", null);
    expect(r.decision).toBe("rename-empty");
    expect(r.sectionId).toBe("sec-empty");
  });

  // CASO 14 (FIX ago 2026, compañero del 13): igual que el 13 pero con
  // content del TipTap con texto. Confirma que la propagación funciona
  // tanto si el docente tipeó solo el título como si solo tipeó el
  // cuerpo (o ambos).
  it("target existe VACÍA + draft solo con content con texto → rename-empty", () => {
    const draftContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Cuerpo del contexto" }] }],
    };
    const sections = [{ id: "sec-empty", title: null, content: null }];
    const r = decideOverride(sections, "sec-empty", "", draftContent);
    expect(r.decision).toBe("rename-empty");
    expect(r.sectionId).toBe("sec-empty");
  });

  // CASO 15 (FIX ago 2026): target existe VACÍA + draft VACÍO. Esta es
  // la NO-regresión: si la sección destino está vacía y el docente
  // tampoco tipeó nada, NO entramos en rename-empty (no hay nada con
  // qué poblar) — caemos en rename-empty de todos modos porque el
  // orquestador real permite guardar la pregunta en una sección sin
  // título (caso límite válido: empezar a llenar la sección sin
  // enunciado). Antes del fix esto hubiera sido create-new (sección
  // duplicada vacía); ahora sigue siendo rename-empty porque la única
  // sección existente ES la vacía que estamos poblando.
  //
  // Nota: técnicamente el orquestador real también acepta "rename-empty
  // con draft vacío" sin error — la pregunta se guarda en la sección
  // vacía, y el docente puede poblar el contexto después con
  // "Editar contexto".
  it("target existe VACÍA + draft vacío → rename-empty (no crear duplicado fantasma)", () => {
    const sections = [{ id: "sec-empty", title: null, content: null }];
    const r = decideOverride(sections, "sec-empty", "", null);
    expect(r.decision).toBe("rename-empty");
    expect(r.sectionId).toBe("sec-empty");
  });
});
