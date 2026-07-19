/**
 * Tests del resolver `getResolvedBundleTheme` y del schema `updateThemeSchema`.
 *
 * Cubre la regla de precedencia bundle > institución > default, y la forma
 * de los payloads que llegan al endpoint PATCH /api/bundles/[id]/theme.
 */
import { describe, it, expect } from "vitest";
import { mergeTheme } from "@/modules/theme/domain/theme";
import { createBundleSchema, updateThemeSchema } from "@/app/api/bundles/_schemas";

// `mergeTheme(institutional, evaluation)` → el segundo arg pisa al primero.
// En el resolver de bundle: `mergeTheme(parseInstitution, parseBundleOverride)`.

describe("bundle-theme · precedencia en mergeTheme", () => {
  it("override del bundle gana sobre el tema institucional", () => {
    const t = mergeTheme(
      { primary: "#111111", fontFamily: "serif", density: "compact" },
      { primary: "#1E40AF", fontFamily: "sans" }, // override parcial
    );
    expect(t.primary).toBe("#1E40AF"); // gana override
    expect(t.fontFamily).toBe("sans"); // gana override
    expect(t.density).toBe("compact"); // cae al institucional
  });

  it("override del bundle cubre los campos solo-de-evaluation (coverSubtitle / sectionDivider / introText)", () => {
    const t = mergeTheme(
      { primary: "#0B5C2E" },
      {
        coverSubtitle: "Grado Undécimo · Periodo I",
        sectionDivider: "double",
        introText: { type: "doc", content: [] },
      },
    );
    expect(t.coverSubtitle).toBe("Grado Undécimo · Periodo I");
    expect(t.sectionDivider).toBe("double");
    expect(t.introText).toEqual({ type: "doc", content: [] });
  });

  it("sin override del bundle (null) el tema colapsa a institución + defaults", () => {
    const t = mergeTheme({ primary: "#0B5C2E", fontFamily: "serif" }, null);
    expect(t.primary).toBe("#0B5C2E");
    expect(t.fontFamily).toBe("serif");
    expect(t.coverSubtitle).toBe("");
    expect(t.sectionDivider).toBe("line");
  });

  it("override vacío {} (sin campos) deja el tema idéntico al institucional", () => {
    const inst = mergeTheme({ primary: "#0B5C2E", fontFamily: "serif", density: "normal" }, null);
    const fromBundle = mergeTheme(
      { primary: "#0B5C2E", fontFamily: "serif", density: "normal" },
      {},
    );
    expect(fromBundle).toEqual(inst);
  });
});

describe("bundle-theme · updateThemeSchema (PATCH /api/bundles/[id]/theme)", () => {
  it("acepta theme con subset parcial de campos", () => {
    const r = updateThemeSchema.safeParse({
      theme: { coverSubtitle: "Grado Undécimo", primary: "#1E40AF" },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.theme?.coverSubtitle).toBe("Grado Undécimo");
      expect(r.data.theme?.primary).toBe("#1E40AF");
    }
  });

  it("rechaza theme con primary inválido (no hex)", () => {
    const r = updateThemeSchema.safeParse({ theme: { primary: "rojo" } });
    expect(r.success).toBe(false);
  });

  it("rechaza theme con fontFamily fuera del enum", () => {
    const r = updateThemeSchema.safeParse({ theme: { fontFamily: "comic-sans" } });
    expect(r.success).toBe(false);
  });

  it("rechaza theme con density fuera del enum", () => {
    const r = updateThemeSchema.safeParse({ theme: { density: "huge" } });
    expect(r.success).toBe(false);
  });

  it("acepta theme = null (reset al institucional)", () => {
    const r = updateThemeSchema.safeParse({ theme: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.theme).toBeNull();
  });

  it("acepta theme = {} (override vacío)", () => {
    const r = updateThemeSchema.safeParse({ theme: {} });
    expect(r.success).toBe(true);
  });

  it("rechaza body sin la clave theme", () => {
    const r = updateThemeSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("rechaza theme que no es objeto (string)", () => {
    const r = updateThemeSchema.safeParse({ theme: "css-string" });
    expect(r.success).toBe(false);
  });
});

describe("bundle-theme · createBundleSchema (POST /api/bundles)", () => {
  it("acepta create con theme override parcial", () => {
    const r = createBundleSchema.safeParse({
      name: "Simulacro ICFES",
      evaluationIds: ["019f0000-0000-0000-0000-000000000001"],
      theme: { primary: "#1E40AF", coverSubtitle: "Periodo I" },
    });
    expect(r.success).toBe(true);
  });

  it("rechaza create con theme sin ser objeto (usa string), porque ahora es strict", () => {
    const r = createBundleSchema.safeParse({
      name: "Simulacro ICFES",
      evaluationIds: ["019f0000-0000-0000-0000-000000000001"],
      theme: "no-es-objeto",
    });
    expect(r.success).toBe(false);
  });

  it("acepta create sin theme (campo opcional)", () => {
    const r = createBundleSchema.safeParse({
      name: "Simulacro ICFES",
      evaluationIds: ["019f0000-0000-0000-0000-000000000001"],
    });
    expect(r.success).toBe(true);
  });
});
