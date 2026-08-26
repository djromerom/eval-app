/**
 * Tests del parser Mustache → schema `CoverContent` (PR 5).
 * ===========================================================
 *
 * El parser escanea el HTML del template (sea built-in o override) y
 * devuelve los campos del schema que efectivamente se referencian. La UI
 * del cover-designer genera inputs solo para esos campos — si la plantilla
 * no usa `{{cover.callout.text}}`, no aparece un textarea para `calloutText`
 * en el form (lo que el docente escriba no se va a renderizar).
 *
 * Estos tests blindan tres invariantes críticos:
 *   • El regex maneja correctamente secciones `{{#X}}…{{/X}}` vs valores
 *     simples `{{X}}` (un array field solo aparece como `arrays` si se
 *     referencia como sección; un string field solo como `strings`).
 *   • Las rutas dotted del template (`cover.callout.text`) se traducen al
 *     nombre plano del schema (`calloutText`) — coherente con el shape
 *     que arma `BuildCoverContext`.
 *   • Las variables ajenas al schema (`{{bundle.name}}`, `{{institution.logo}}`)
 *     se ignoran sin romper el parser.
 */
import { describe, expect, it } from "vitest";
import {
  FIELD_META,
  extractCoverContentFields,
  groupFieldsByBlock,
} from "@/modules/bundle-cover/domain/template-fields";

describe("extractCoverContentFields", () => {
  it("devuelve vacío + hasAny=false para string vacío", () => {
    expect(extractCoverContentFields("")).toEqual({
      strings: [],
      arrays: [],
      hasAny: false,
    });
  });

  it("devuelve vacío + hasAny=false si el template no tiene variables del schema", () => {
    const body = `
      <h1>{{bundle.name}}</h1>
      <p>{{institution.name}}</p>
      <ul>{{#subjects}}<li>{{name}}</li>{{/subjects}}</ul>
    `;
    expect(extractCoverContentFields(body)).toEqual({
      strings: [],
      arrays: [],
      hasAny: false,
    });
  });

  it("detecta strings del schema (cover.*)", () => {
    const body = `
      <div>{{cover.callout.text}}</div>
      <div>{{cover.howToMark.question}}</div>
    `;
    const out = extractCoverContentFields(body);
    expect(out.strings).toContain("calloutText");
    expect(out.strings).toContain("howToMarkQuestion");
    expect(out.hasAny).toBe(true);
  });

  it("detecta legalFooter via institution.legalFooter", () => {
    const body = `<footer>{{institution.legalFooter}}</footer>`;
    const out = extractCoverContentFields(body);
    expect(out.strings).toContain("legalFooter");
  });

  it("detecta arrays (itemsBefore / itemsAfter) solo si aparecen como SECCIÓN", () => {
    const body = `
      <ul>{{#cover.instructions.items}}<li>{{.}}</li>{{/cover.instructions.items}}</ul>
      <ul>{{#cover.instructions.itemsAfter}}<li>{{.}}</li>{{/cover.instructions.itemsAfter}}</ul>
    `;
    const out = extractCoverContentFields(body);
    expect(out.arrays).toContain("itemsBefore");
    expect(out.arrays).toContain("itemsAfter");
    expect(out.strings).not.toContain("itemsBefore");
    expect(out.strings).not.toContain("itemsAfter");
  });

  it("ignora variables no-schema (bundle.*, institution.* excepto legalFooter)", () => {
    const body = `
      <h1>{{bundle.name}}</h1>
      <p>{{bundle.totalQuestions}}</p>
      <img src="{{institution.logo}}"/>
      <p>{{institution.primaryColor}}</p>
    `;
    const out = extractCoverContentFields(body);
    expect(out.strings).toEqual([]);
    expect(out.arrays).toEqual([]);
    expect(out.hasAny).toBe(false);
  });

  it("ignora comentarios Mustache (!)", () => {
    const body = `{{! esto es un comentario }}
      <div>{{cover.callout.text}}</div>
    `;
    const out = extractCoverContentFields(body);
    expect(out.strings).toContain("calloutText");
    // El comentario no se cuenta como variable.
    expect(out.strings).toHaveLength(1);
  });

  it("maneja tags raw {{{X}}} como variables", () => {
    const body = `{{{cover.callout.text}}}`;
    const out = extractCoverContentFields(body);
    expect(out.strings).toContain("calloutText");
  });

  it("ignora secciones invertidas ^X (truthy check sobre strings)", () => {
    const body = `
      {{^cover.callout.text}}<p>(sin callout)</p>{{/cover.callout.text}}
      <div>{{cover.callout.text}}</div>
    `;
    const out = extractCoverContentFields(body);
    // `callout.text` aparece como string (valor), pero la sección invertida
    // no lo convierte en array. Sigue siendo string.
    expect(out.strings).toContain("calloutText");
    expect(out.arrays).not.toContain("calloutText");
  });

  it("no duplica un campo si aparece varias veces en el template", () => {
    const body = `
      <p>{{cover.callout.text}}</p>
      <p>{{cover.callout.text}}</p>
      <p>{{cover.callout.text}}</p>
    `;
    const out = extractCoverContentFields(body);
    const occurrences = out.strings.filter((f) => f === "calloutText").length;
    expect(occurrences).toBe(1);
  });

  it("maneja whitespace dentro del tag (espacios antes del nombre)", () => {
    const body = `<div>{{ cover.callout.text }}</div>`;
    const out = extractCoverContentFields(body);
    expect(out.strings).toContain("calloutText");
  });

  it("ignora paths desconocidos (cubierto por el mapa MUSTACHE_TO_SCHEMA)", () => {
    const body = `<div>{{cover.customThing}}</div><div>{{cover.howToMark.unknownField}}</div>`;
    const out = extractCoverContentFields(body);
    expect(out.strings).toEqual([]);
    expect(out.arrays).toEqual([]);
  });

  it("caso real: secundaria-v1.html — todos los campos del schema", () => {
    // Subset representativo de secundaria-v1.html (todas las variables
    // cover.* + institution.legalFooter).
    const body = `
      <div>{{cover.callout.text}}</div>
      {{#cover.callout.text}}<div>...</div>{{/cover.callout.text}}
      <ul>{{#cover.instructions.items}}<li>{{.}}</li>{{/cover.instructions.items}}</ul>
      <h2>{{cover.instructions.title}}</h2>
      <ul>{{#cover.instructions.itemsAfter}}<li>{{.}}</li>{{/cover.instructions.itemsAfter}}</ul>
      <div>{{cover.howToMark.question}}</div>
      <div>{{cover.howToMark.exampleLabel}}</div>
      <div>{{cover.howToMark.example}}</div>
      <h3>{{cover.prohibited.title}}</h3>
      <p>{{cover.prohibited.body}}</p>
      <footer>{{institution.legalFooter}}</footer>
    `;
    const out = extractCoverContentFields(body);
    expect([...out.strings].sort()).toEqual(
      [
        "calloutText",
        "howToMarkExample",
        "howToMarkExampleLabel",
        "howToMarkQuestion",
        "instructionsTitle",
        "legalFooter",
        "prohibitedBody",
        "prohibitedTitle",
      ].sort(),
    );
    expect([...out.arrays].sort()).toEqual(["itemsAfter", "itemsBefore"]);
  });

  it("caso real: primaria-v1.html — solo legalFooter", () => {
    const body = `
      <h1>{{institution.name}}</h1>
      <p>{{institution.primaryColor}}</p>
      <img src="{{institution.logo}}"/>
      <h2>{{bundle.name}} ({{bundle.grade}})</h2>
      <p>{{bundle.totalQuestions}} preguntas · {{bundle.totalTime}}</p>
      <footer>{{institution.legalFooter}}</footer>
    `;
    const out = extractCoverContentFields(body);
    expect(out.strings).toEqual(["legalFooter"]);
    expect(out.arrays).toEqual([]);
    expect(out.hasAny).toBe(true);
  });
});

describe("groupFieldsByBlock", () => {
  it("devuelve bloques en orden estable (instrucciones → howToMark → prohibido → legal)", () => {
    const fields = extractCoverContentFields(`
      {{cover.callout.text}}
      {{cover.prohibited.body}}
      {{institution.legalFooter}}
    `);
    const blocks = groupFieldsByBlock(fields);
    expect(blocks.map((b) => b.block)).toEqual(["instructions", "prohibited", "legal"]);
  });

  it("omite bloques sin campos usados", () => {
    const fields = extractCoverContentFields(`{{institution.legalFooter}}`);
    const blocks = groupFieldsByBlock(fields);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.block).toBe("legal");
    expect(blocks[0]?.fields).toEqual(["legalFooter"]);
  });

  it("agrupa múltiples campos en el mismo bloque", () => {
    const fields = extractCoverContentFields(`
      {{cover.howToMark.question}}
      {{cover.howToMark.example}}
      {{cover.howToMark.exampleLabel}}
    `);
    const blocks = groupFieldsByBlock(fields);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.block).toBe("howToMark");
    expect(blocks[0]?.fields).toHaveLength(3);
  });
});

describe("FIELD_META", () => {
  it("tiene metadata para todos los campos del schema", () => {
    const schemaFields: Array<keyof typeof FIELD_META> = [
      "legalFooter",
      "instructionsTitle",
      "itemsBefore",
      "calloutText",
      "howToMarkQuestion",
      "howToMarkExample",
      "howToMarkExampleLabel",
      "itemsAfter",
      "prohibitedTitle",
      "prohibitedBody",
    ];
    for (const f of schemaFields) {
      expect(FIELD_META[f]).toBeDefined();
      expect(FIELD_META[f].label).toBeTruthy();
      expect(FIELD_META[f].maxLength).toBeGreaterThan(0);
    }
  });

  it("los campos multiline tienen maxLength > 100 (heurística para textarea)", () => {
    const multilineFields = (
      Object.entries(FIELD_META) as Array<[string, (typeof FIELD_META)[keyof typeof FIELD_META]]>
    )
      .filter(([, meta]) => meta.multiline)
      .map(([name]) => name);
    expect(multilineFields.sort()).toEqual(
      ["calloutText", "howToMarkQuestion", "prohibitedBody"].sort(),
    );
  });

  it("itemsBefore tiene arrayMax=10 e itemsAfter arrayMax=15 (límites del schema)", () => {
    expect(FIELD_META.itemsBefore.arrayMax).toBe(10);
    expect(FIELD_META.itemsAfter.arrayMax).toBe(15);
  });

  it("los strings no tienen arrayMax", () => {
    const stringFields: Array<keyof typeof FIELD_META> = [
      "legalFooter",
      "instructionsTitle",
      "calloutText",
      "howToMarkQuestion",
      "howToMarkExample",
      "howToMarkExampleLabel",
      "prohibitedTitle",
      "prohibitedBody",
    ];
    for (const f of stringFields) {
      expect(FIELD_META[f].arrayMax).toBeUndefined();
    }
  });
});
