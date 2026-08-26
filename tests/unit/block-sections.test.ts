/**
 * Tests de los helpers de visibilidad de bloques del Cover Studio (ago 2026).
 * ========================================================================
 *
 * El Studio permite al docente apagar/prender bloques estructurales del HTML
 * de portada. Estos tests blindan:
 *
 *   • Identificación correcta del estado (presente vs strippeado vs ausente)
 *     leyendo el HTML actual. Esto inicializa los checkboxes de la UI.
 *   • Strip idempotente: strippear dos veces el mismo bloque no acumula
 *     `{{!stripped:ID}}` duplicados.
 *   • Restore desde built-in preservando marcadores para futuros strips.
 *   • Sección Mustache (itemsBefore / callout / itemsAfter) vs marker HTML
 *     (howToMark / prohibited / legalFooter) — los dos mecanismos se
 *     conjugan en `applyBlockState`.
 *   • Edge cases: HTML custom sin marcadores, secciones anidadas, restaurado
 *     de un bloque ausente.
 *
 * Si un test rompe, revisa los IDs en `STUDIO_BLOCK_IDS` y la lógica de
 * strip/restore en `block-sections.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  STUDIO_BLOCK_IDS,
  allBlocksOn,
  applyBlockState,
  extractBuiltinBlock,
  identifyActiveBlocks,
  isStudioBlockId,
  missingBuiltinBlockMarkers,
  __testing,
  type StudioBlockId,
  type StudioBlockState,
} from "@/modules/bundle-cover/domain/block-sections";

// Subset representativo de secundaria-v1.html con todos los marcadores
// STUDIO-BLOCK colocados (cómo marcar, prohibido, legalFooter). Las
// secciones Mustache (itemsBefore, callout, itemsAfter) son intrínsecas.
const BUILTIN_BODY = `
<!doctype html>
<html>
  <body>
    <div class="instrucciones">
      <h2>{{cover.instructions.title}}</h2>
      <ul>
        {{#cover.instructions.items}}<li>{{.}}</li>{{/cover.instructions.items}}
      </ul>

      {{#cover.callout.text}}
        <div class="callout">{{cover.callout.text}}</div>
      {{/cover.callout.text}}

      <!--STUDIO-BLOCK:howToMark:START-->
      <div class="mark-row">
        <div class="mark-text">
          {{cover.howToMark.question}}<br/>
          {{cover.howToMark.example}}
        </div>
        <div class="mark-example">
          <div class="label">{{cover.howToMark.exampleLabel}}</div>
          <div class="bubbles">
            {{#cover.howToMark.circles}}
              <div class="bubble{{#filled}} filled{{/filled}}">{{letter}}</div>
            {{/cover.howToMark.circles}}
          </div>
        </div>
      </div>
      <!--STUDIO-BLOCK:howToMark:END-->

      {{#cover.instructions.itemsAfter}}
        <ul>
          {{#cover.instructions.itemsAfter}}<li>{{.}}</li>{{/cover.instructions.itemsAfter}}
        </ul>
      {{/cover.instructions.itemsAfter}}
    </div>

    <!--STUDIO-BLOCK:prohibited:START-->
    <div class="prohibido-tag">{{cover.prohibited.title}}</div>
    <div class="prohibido-band">
      <p>{{cover.prohibited.body}}</p>
      <!--STUDIO-BLOCK:legalFooter:START-->
      <p class="bold">{{institution.legalFooter}}</p>
      <!--STUDIO-BLOCK:legalFooter:END-->
    </div>
    <!--STUDIO-BLOCK:prohibited:END-->
  </body>
</html>
`;

describe("STUDIO_BLOCK_IDS", () => {
  it("tiene 6 IDs estables", () => {
    expect(STUDIO_BLOCK_IDS).toHaveLength(6);
    expect([...STUDIO_BLOCK_IDS].sort()).toEqual(
      ["callout", "howToMark", "itemsAfter", "itemsBefore", "legalFooter", "prohibited"].sort(),
    );
  });
});

describe("allBlocksOn", () => {
  it("devuelve un state con todos los bloques prendidos", () => {
    const s = allBlocksOn();
    for (const id of STUDIO_BLOCK_IDS) {
      expect(s[id]).toBe(true);
    }
  });
});

describe("isStudioBlockId", () => {
  it("acepta IDs válidos", () => {
    expect(isStudioBlockId("callout")).toBe(true);
    expect(isStudioBlockId("howToMark")).toBe(true);
  });

  it("rechaza IDs desconocidos", () => {
    expect(isStudioBlockId("inventado")).toBe(false);
    expect(isStudioBlockId("")).toBe(false);
  });
});

describe("identifyActiveBlocks", () => {
  it("builtin con todos los marcadores → todos los bloques activos", () => {
    const state = identifyActiveBlocks(BUILTIN_BODY);
    expect(state).toEqual(allBlocksOn());
  });

  it("bloque strippeado (con marker {{!stripped:ID}}) → inactivo", () => {
    const html = BUILTIN_BODY.replace(
      /{{#cover\.callout\.text}}[\s\S]*?{{\/cover\.callout\.text}}/,
      __testing.STRIPPED_MARKER("callout"),
    );
    const state = identifyActiveBlocks(html);
    expect(state.callout).toBe(false);
    // El resto sigue activo
    expect(state.itemsBefore).toBe(true);
    expect(state.howToMark).toBe(true);
    expect(state.prohibited).toBe(true);
  });

  it("bloque ausente del HTML (eliminado por edición manual) → inactivo", () => {
    const html = BUILTIN_BODY.replace(
      /<!--STUDIO-BLOCK:howToMark:START-->[\s\S]*?<!--STUDIO-BLOCK:howToMark:END-->/,
      "",
    );
    const state = identifyActiveBlocks(html);
    expect(state.howToMark).toBe(false);
  });

  it("sección Mustache ausente del HTML → inactivo", () => {
    const html = BUILTIN_BODY.replace(
      /{{#cover\.instructions\.items}}[\s\S]*?{{\/cover\.instructions\.items}}/,
      "",
    );
    const state = identifyActiveBlocks(html);
    expect(state.itemsBefore).toBe(false);
  });

  it("strip marker presente tiene precedencia sobre sección presente (caso patológico)", () => {
    // Un HTML con ambos (marker de strip + sección) debería contar como off,
    // porque `identifyActiveBlocks` chequea primero el stripped.
    const weirdHtml = `${__testing.STRIPPED_MARKER("callout")}{{#cover.callout.text}}x{{/cover.callout.text}}`;
    const state = identifyActiveBlocks(weirdHtml);
    expect(state.callout).toBe(false);
  });
});

describe("applyBlockState — strip", () => {
  it("strippear itemsBefore (sección Mustache) deja un solo {{!stripped:itemsBefore}}", () => {
    const desired: StudioBlockState = { ...allBlocksOn(), itemsBefore: false };
    const out = applyBlockState(BUILTIN_BODY, desired, BUILTIN_BODY);
    expect(out).toContain("{{!stripped:itemsBefore}}");
    expect(out).not.toMatch(/{{#cover\.instructions\.items}}/);
    // El resto sigue intacto
    expect(out).toContain("{{#cover.callout.text}}");
    expect(out).toContain("{{#cover.instructions.itemsAfter}}");
  });

  it("strippear howToMark (marcadores HTML) borra el bloque y deja marker", () => {
    const desired: StudioBlockState = { ...allBlocksOn(), howToMark: false };
    const out = applyBlockState(BUILTIN_BODY, desired, BUILTIN_BODY);
    expect(out).toContain("{{!stripped:howToMark}}");
    expect(out).not.toContain("<!--STUDIO-BLOCK:howToMark:START-->");
    expect(out).not.toContain('<div class="mark-row">');
  });

  it('strippear legalFooter solo borra el <p class="bold"> con {{institution.legalFooter}}', () => {
    const desired: StudioBlockState = { ...allBlocksOn(), legalFooter: false };
    const out = applyBlockState(BUILTIN_BODY, desired, BUILTIN_BODY);
    expect(out).toContain("{{!stripped:legalFooter}}");
    expect(out).not.toContain("{{institution.legalFooter}}");
    // El resto del bloque prohibido sigue intacto
    expect(out).toContain('<div class="prohibido-tag">');
    expect(out).toContain("{{cover.prohibited.body}}");
  });

  it("strip idempotente: aplicar el mismo desired dos veces no duplica markers", () => {
    const desired: StudioBlockState = { ...allBlocksOn(), callout: false };
    const once = applyBlockState(BUILTIN_BODY, desired, BUILTIN_BODY);
    const twice = applyBlockState(once, desired, BUILTIN_BODY);
    const occurrences = twice.split("{{!stripped:callout}}").length - 1;
    expect(occurrences).toBe(1);
  });
});

describe("applyBlockState — restore", () => {
  it("restaurar callout desde builtin re-inyecta la sección Mustache", () => {
    const stripped = BUILTIN_BODY.replace(
      /{{#cover\.callout\.text}}[\s\S]*?{{\/cover\.callout\.text}}/,
      __testing.STRIPPED_MARKER("callout"),
    );
    const desired: StudioBlockState = { ...allBlocksOn(), callout: true };
    const out = applyBlockState(stripped, desired, BUILTIN_BODY);
    expect(out).toContain("{{#cover.callout.text}}");
    expect(out).toContain("{{cover.callout.text}}");
    expect(out).toContain("{{/cover.callout.text}}");
    expect(out).not.toContain("{{!stripped:callout}}");
  });

  it("restaurar howToMark desde builtin re-inyecta los marcadores HTML", () => {
    const stripped = BUILTIN_BODY.replace(
      /<!--STUDIO-BLOCK:howToMark:START-->[\s\S]*?<!--STUDIO-BLOCK:howToMark:END-->/,
      __testing.STRIPPED_MARKER("howToMark"),
    );
    const desired: StudioBlockState = { ...allBlocksOn(), howToMark: true };
    const out = applyBlockState(stripped, desired, BUILTIN_BODY);
    expect(out).toContain("<!--STUDIO-BLOCK:howToMark:START-->");
    expect(out).toContain('<div class="mark-row">');
    expect(out).toContain("<!--STUDIO-BLOCK:howToMark:END-->");
    expect(out).not.toContain("{{!stripped:howToMark}}");
  });

  it("restaurar un bloque tras un strip preserva la posibilidad de volver a strippear", () => {
    let html = BUILTIN_BODY;
    html = applyBlockState(html, { ...allBlocksOn(), itemsAfter: false }, BUILTIN_BODY);
    html = applyBlockState(html, { ...allBlocksOn(), itemsAfter: true }, BUILTIN_BODY);
    html = applyBlockState(html, { ...allBlocksOn(), itemsAfter: false }, BUILTIN_BODY);
    expect(html).toContain("{{!stripped:itemsAfter}}");
    expect(html).not.toMatch(/{{#cover\.instructions\.itemsAfter}}/);
  });

  it("restore de un bloque no presente (no hay marker) es no-op", () => {
    // Simulamos HTML custom que no tiene el bloque callout ni el stripped marker.
    const customHtml = BUILTIN_BODY.replace(
      /{{#cover\.callout\.text}}[\s\S]*?{{\/cover\.callout\.text}}/,
      "",
    );
    const desired: StudioBlockState = { ...allBlocksOn(), callout: true };
    const out = applyBlockState(customHtml, desired, BUILTIN_BODY);
    // No deberíamos meter el bloque en una posición aleatoria.
    expect(out).not.toContain("{{#cover.callout.text}}");
    expect(out).toBe(customHtml);
  });
});

describe("applyBlockState — multi-bloque", () => {
  it("prender y apagar varios bloques en una sola pasada", () => {
    const desired: StudioBlockState = {
      ...allBlocksOn(),
      callout: false,
      howToMark: false,
      legalFooter: false,
    };
    const out = applyBlockState(BUILTIN_BODY, desired, BUILTIN_BODY);
    expect(out).toContain("{{!stripped:callout}}");
    expect(out).toContain("{{!stripped:howToMark}}");
    expect(out).toContain("{{!stripped:legalFooter}}");
    expect(out).toContain("{{#cover.instructions.items}}");
    expect(out).toContain("{{#cover.instructions.itemsAfter}}");
    expect(out).toContain("{{cover.prohibited.body}}");
  });

  it("revertir todo (todos los bloques encendidos) deja el HTML idéntico al builtin", () => {
    let html = BUILTIN_BODY;
    html = applyBlockState(html, { ...allBlocksOn(), callout: false }, BUILTIN_BODY);
    html = applyBlockState(html, { ...allBlocksOn(), howToMark: false }, BUILTIN_BODY);
    html = applyBlockState(html, { ...allBlocksOn(), legalFooter: false }, BUILTIN_BODY);
    html = applyBlockState(html, allBlocksOn(), BUILTIN_BODY);
    expect(html).toBe(BUILTIN_BODY);
  });
});

describe("extractBuiltinBlock", () => {
  it("extrae el bloque howToMark entre marcadores (contenido sin markers)", () => {
    const block = extractBuiltinBlock(BUILTIN_BODY, "howToMark");
    expect(block).not.toBeNull();
    expect(block).toContain('<div class="mark-row">');
    // El contenido extraído NO incluye los markers (group 2 de la regex).
    expect(block).not.toContain("<!--STUDIO-BLOCK:howToMark:START-->");
    expect(block).not.toContain("<!--STUDIO-BLOCK:howToMark:END-->");
  });

  it("extrae la sección itemsBefore", () => {
    const block = extractBuiltinBlock(BUILTIN_BODY, "itemsBefore");
    expect(block).not.toBeNull();
    expect(block).toMatch(
      /{{#cover\.instructions\.items}}[\s\S]*?{{\/cover\.instructions\.items}}/,
    );
  });

  it("devuelve null para bloques que no existen en el builtin", () => {
    expect(extractBuiltinBlock("<p>x</p>", "callout")).toBeNull();
    expect(extractBuiltinBlock("<p>x</p>", "howToMark")).toBeNull();
  });
});

describe("missingBuiltinBlockMarkers", () => {
  it("devuelve [] si el builtin tiene todos los marcadores", () => {
    expect(missingBuiltinBlockMarkers(BUILTIN_BODY)).toEqual([]);
  });

  it("lista los IDs de marcadores ausentes", () => {
    const noMarkers = BUILTIN_BODY.replace(
      /<!--STUDIO-BLOCK:howToMark:START-->[\s\S]*?<!--STUDIO-BLOCK:howToMark:END-->/,
      "",
    );
    const missing = missingBuiltinBlockMarkers(noMarkers);
    expect(missing).toContain("howToMark");
    expect(missing).not.toContain("itemsBefore"); // itemsBefore es sección, no marker
  });
});

describe("__testing helpers — regex interna", () => {
  it("STRIPPED_MARKER genera el formato esperado", () => {
    expect(__testing.STRIPPED_MARKER("callout")).toBe("{{!stripped:callout}}");
  });

  it("startMarker y endMarker generan comentarios HTML", () => {
    const id = "foo" as StudioBlockId;
    expect(__testing.startMarker(id)).toBe("<!--STUDIO-BLOCK:foo:START-->");
    expect(__testing.endMarker(id)).toBe("<!--STUDIO-BLOCK:foo:END-->");
  });

  it("mustacheSectionRegex matchea una sección con saltos de línea", () => {
    const body = "A\n{{#x}}contenido\nmultilinea{{/x}}\nB";
    const re = __testing.mustacheSectionRegex("x");
    const m = body.match(re);
    expect(m?.[0]).toContain("multilinea");
  });

  it("markerBlockRegex captura el contenido entre START y END", () => {
    const body = `<!--STUDIO-BLOCK:foo:START-->middle<!--STUDIO-BLOCK:foo:END-->`;
    const re = __testing.markerBlockRegex("foo" as StudioBlockId);
    // `g` flag + String.match() devuelve matches sin capture groups — usamos
    // exec() sin estado (la regex tiene `g`, pero `exec` con lastIndex=0 nos
    // da los grupos).
    re.lastIndex = 0;
    const m = re.exec(body);
    expect(m?.[2]).toBe("middle");
  });
});

// Bonus: invariantes de flujo roundtrip
describe("roundtrip builtin → strip → restore → strip → restore", () => {
  it("todos los bloques sobreviven 4 ciclos sin perder contenido", () => {
    let html = BUILTIN_BODY;
    const ids: StudioBlockId[] = [...STUDIO_BLOCK_IDS];
    for (let i = 0; i < 2; i++) {
      // Apagar todos
      html = applyBlockState(
        html,
        Object.fromEntries(ids.map((id) => [id, false])) as StudioBlockState,
        BUILTIN_BODY,
      );
      // Encender todos
      html = applyBlockState(html, allBlocksOn(), BUILTIN_BODY);
    }
    // Tras 2 rondas de apagar/encender todo, el HTML debe ser idéntico al builtin.
    expect(html).toBe(BUILTIN_BODY);
  });
});
