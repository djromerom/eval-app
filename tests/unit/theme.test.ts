import { describe, it, expect } from "vitest";
import {
  INSTITUTIONAL_DEFAULT,
  THEME_PRESETS,
  mergeTheme,
  parseEvaluationTheme,
  parseInstitutionalTheme,
  themeToCssVars,
} from "@/modules/theme/domain/theme";

describe("theme · mergeTheme", () => {
  it("devuelve los defaults si nada se pasa", () => {
    const t = mergeTheme(null, null);
    expect(t.primary).toBe(INSTITUTIONAL_DEFAULT.primary);
    expect(t.fontFamily).toBe(INSTITUTIONAL_DEFAULT.fontFamily);
    expect(t.density).toBe(INSTITUTIONAL_DEFAULT.density);
    expect(t.showLogo).toBe(true);
    expect(t.coverSubtitle).toBe("");
    expect(t.sectionDivider).toBe("line");
    expect(t.introText).toBeNull();
  });

  it("precedencia: evaluation override gana sobre institutional", () => {
    const t = mergeTheme(
      { primary: "#111111", fontFamily: "serif", density: "compact" },
      { primary: "#222222", fontFamily: "sans" },
    );
    expect(t.primary).toBe("#222222"); // gana eval
    expect(t.fontFamily).toBe("sans"); // gana eval
    expect(t.density).toBe("compact"); // cae al institucional
  });

  it("precedencia: institutional gana sobre defaults cuando no hay override", () => {
    const t = mergeTheme({ primary: "#AABBCC", density: "airy" }, null);
    expect(t.primary).toBe("#AABBCC");
    expect(t.density).toBe("airy");
    expect(t.fontFamily).toBe(INSTITUTIONAL_DEFAULT.fontFamily);
  });

  it("coverSubtitle / sectionDivider / introText son solo de evaluación", () => {
    const t = mergeTheme(
      { primary: "#111111" },
      { coverSubtitle: "Periodo I", sectionDivider: "double" },
    );
    expect(t.coverSubtitle).toBe("Periodo I");
    expect(t.sectionDivider).toBe("double");
  });
});

describe("theme · parseInstitutionalTheme / parseEvaluationTheme", () => {
  it("parseInstitutionalTheme descarta campos con tipo inválido pero conserva los buenos", () => {
    // El hex inválido se descarta; el válido se conserva.
    const t = parseInstitutionalTheme({
      primary: "no-es-hex",
      fontFamily: "fancy",
      showLogo: true,
    });
    expect(t.primary).toBeUndefined();
    expect(t.fontFamily).toBeUndefined();
    expect(t.showLogo).toBe(true);
  });

  it("parseInstitutionalTheme con objeto vacío devuelve {} (sin defaults)", () => {
    // Los defaults los aplica mergeTheme(); el parser preserva el contrato
    // "Partial<>" sin inventar valores.
    expect(parseInstitutionalTheme({})).toEqual({});
  });

  it("parseEvaluationTheme no rompe con JSON cualquiera", () => {
    expect(() => parseEvaluationTheme({ random: true })).not.toThrow();
    expect(() => parseEvaluationTheme(null)).not.toThrow();
    expect(() => parseEvaluationTheme(undefined)).not.toThrow();
    expect(() => parseEvaluationTheme("string")).not.toThrow();
    expect(parseEvaluationTheme({ random: true })).toEqual({});
  });

  it("parseInstitutionalTheme ignora campos desconocidos sin quejarse", () => {
    const t = parseInstitutionalTheme({ primary: "#0B5C2E", extra: "garbage" }) as Record<
      string,
      unknown
    >;
    expect(t.primary).toBe("#0B5C2E");
    expect(t.extra).toBeUndefined();
  });
});

describe("theme · THEME_PRESETS", () => {
  it("clasico coincide con INSTITUTIONAL_DEFAULT", () => {
    const clasico = THEME_PRESETS.clasico!;
    expect(clasico.theme.primary).toBe(INSTITUTIONAL_DEFAULT.primary);
    expect(clasico.theme.fontFamily).toBe(INSTITUTIONAL_DEFAULT.fontFamily);
    expect(clasico.theme.density).toBe(INSTITUTIONAL_DEFAULT.density);
  });

  it("moderno usa sans + airy + color azul", () => {
    const moderno = THEME_PRESETS.moderno!;
    expect(moderno.theme.fontFamily).toBe("sans");
    expect(moderno.theme.density).toBe("airy");
    expect(moderno.theme.primary).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it("compacto usa density=compact", () => {
    const compacto = THEME_PRESETS.compacto!;
    expect(compacto.theme.density).toBe("compact");
  });
});

describe("theme · themeToCssVars", () => {
  it("emite todas las custom properties esperadas", () => {
    const vars = themeToCssVars(mergeTheme(null, null));
    expect(vars).toHaveProperty("--print-primary");
    expect(vars).toHaveProperty("--print-font-family");
    expect(vars).toHaveProperty("--print-line-height");
    expect(vars).toHaveProperty("--print-show-logo");
    expect(vars["--print-show-logo"]).toBe("block");
  });

  it("font-family sans apunta a Liberation Sans", () => {
    const t = mergeTheme({ fontFamily: "sans" }, null);
    expect(themeToCssVars(t)["--print-font-family"]).toContain("Liberation Sans");
  });

  it("showLogo=false → display:none", () => {
    const t = mergeTheme({ showLogo: false }, null);
    expect(themeToCssVars(t)["--print-show-logo"]).toBe("none");
  });

  it("density airy → line-height 1.4", () => {
    const t = mergeTheme({ density: "airy" }, null);
    expect(themeToCssVars(t)["--print-line-height"]).toBe("1.4");
  });
});

/**
 * Columnas de preguntas: hereda institución → evaluación como el resto del
 * tema, y llega a la variable CSS que usa la hoja de impresión.
 */
describe("questionColumns", () => {
  it("por defecto es 1 (no cambia la maquetación de lo ya creado)", () => {
    expect(mergeTheme(null, null).questionColumns).toBe(1);
  });

  it("la institución fija el valor y la evaluación lo hereda", () => {
    expect(mergeTheme({ questionColumns: 2 }, null).questionColumns).toBe(2);
    expect(mergeTheme({ questionColumns: 2 }, {}).questionColumns).toBe(2);
  });

  it("la evaluación puede sobreescribir el institucional en ambos sentidos", () => {
    expect(mergeTheme({ questionColumns: 1 }, { questionColumns: 2 }).questionColumns).toBe(2);
    expect(mergeTheme({ questionColumns: 2 }, { questionColumns: 1 }).questionColumns).toBe(1);
  });

  it("llega a la variable CSS de impresión", () => {
    const vars = themeToCssVars(mergeTheme({ questionColumns: 2 }, null));
    expect(vars["--print-question-columns"]).toBe("2");
  });

  it("se lee del JSON guardado en la BD", () => {
    // Regresión: `parseInstitutionalTheme` enumera los campos uno a uno y
    // este faltaba, así que el valor guardado se descartaba en silencio y el
    // PDF salía siempre a una columna. Este assert es el que lo detecta —
    // comprobar solo que un valor inválido da `undefined` pasaba igualmente
    // cuando el parser ni miraba el campo.
    expect(parseInstitutionalTheme({ questionColumns: 2 }).questionColumns).toBe(2);
    expect(parseEvaluationTheme({ questionColumns: 2 }).questionColumns).toBe(2);
  });

  it("un valor inválido se descarta sin romper el resto del tema", () => {
    const parsed = parseInstitutionalTheme({ questionColumns: 7, fontFamily: "sans" });
    expect(parsed.questionColumns).toBeUndefined();
    expect(parsed.fontFamily).toBe("sans");
  });
});

/**
 * Tamaño de fuente de los items (sep 2026). Igual cascada que
 * `questionColumns`: institucional → evaluación → default 10pt. La variable
 * CSS `--print-question-font-size` la consume `.questions-flow` (print.css)
 * y solo afecta al cuerpo de las preguntas — NO a la portada.
 */
describe("questionFontSize", () => {
  it("por defecto es 10pt (replica `.booklet { font-size: 10pt }`)", () => {
    expect(mergeTheme(null, null).questionFontSize).toBe(10);
  });

  it("la institución fija el valor y la evaluación lo hereda", () => {
    expect(mergeTheme({ questionFontSize: 12 }, null).questionFontSize).toBe(12);
    expect(mergeTheme({ questionFontSize: 12 }, {}).questionFontSize).toBe(12);
  });

  it("la evaluación puede sobreescribir el institucional en ambos sentidos", () => {
    expect(mergeTheme({ questionFontSize: 10 }, { questionFontSize: 14 }).questionFontSize).toBe(
      14,
    );
    expect(mergeTheme({ questionFontSize: 14 }, { questionFontSize: 10 }).questionFontSize).toBe(
      10,
    );
  });

  it("llega a la variable CSS de impresión como `${n}pt`", () => {
    const vars = themeToCssVars(mergeTheme({ questionFontSize: 12 }, null));
    expect(vars["--print-question-font-size"]).toBe("12pt");
    const varsDefault = themeToCssVars(mergeTheme(null, null));
    expect(varsDefault["--print-question-font-size"]).toBe("10pt");
  });

  it("se lee del JSON guardado en la BD (regresión: si el parser omite el campo, el valor guardado se descarta en silencio)", () => {
    expect(parseInstitutionalTheme({ questionFontSize: 14 }).questionFontSize).toBe(14);
    expect(parseEvaluationTheme({ questionFontSize: 16 }).questionFontSize).toBe(16);
  });

  it("un valor fuera del set canónico se descarta sin romper el resto del tema", () => {
    const parsed = parseInstitutionalTheme({ questionFontSize: 13, fontFamily: "sans" });
    expect(parsed.questionFontSize).toBeUndefined();
    expect(parsed.fontFamily).toBe("sans");
  });

  it("un valor string en vez de número se descarta", () => {
    const parsed = parseInstitutionalTheme({ questionFontSize: "12pt" });
    expect(parsed.questionFontSize).toBeUndefined();
  });
});
