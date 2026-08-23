/**
 * Tests del walker puro `grapesjs-renderer` (PR 2).
 * ==================================================
 *
 * Solo importa el módulo `domain/grapesjs-renderer.ts` (sin
 * `RenderCover` ni DOMPurify), porque cualquier import de
 * isomorphic-dompurify dispara el error pre-existente de ESM/CJS con
 * `@exodus/bytes`/`html-encoding-sniffer` en este entorno. Los tests del
 * orchestrator `RenderCoverVisual` viven en `render-cover-visual.test.ts`
 * (que sí necesita DOMPurify).
 */
import { describe, expect, it } from "vitest";
import {
  toCoverVisualProject,
  MalformedCoverVisualError,
} from "@/modules/bundle-cover/domain/cover-visual";
import { serialiseProjectToHtml } from "@/modules/bundle-cover/domain/grapesjs-renderer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Construye un proyecto GrapesJS mínimo válido con un componente root. */
function projectWithRoot(rootType: string, extra: Record<string, unknown> = {}) {
  return {
    pages: [
      {
        id: "p1",
        frames: [
          {
            id: "f1",
            component: {
              type: rootType,
              ...extra,
              components: [],
            },
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("grapesjs-renderer — serialiseProjectToHtml", () => {
  // -------- Studio blocks con envelope "marker" ----------------------------

  it("envuelve `studio-how-to-mark` con markers START/END", () => {
    const html = serialiseProjectToHtml(projectWithRoot("studio-how-to-mark"));
    expect(html).toContain("<!--STUDIO-BLOCK:howToMark:START-->");
    expect(html).toContain("<!--STUDIO-BLOCK:howToMark:END-->");
    expect(html).toContain('data-studio-block="howToMark"');
  });

  it("envuelve `studio-prohibited` con markers", () => {
    const html = serialiseProjectToHtml(projectWithRoot("studio-prohibited"));
    expect(html).toContain("<!--STUDIO-BLOCK:prohibited:START-->");
    expect(html).toContain("<!--STUDIO-BLOCK:prohibited:END-->");
  });

  it("envuelve `studio-legal-footer` con markers", () => {
    const html = serialiseProjectToHtml(projectWithRoot("studio-legal-footer"));
    expect(html).toContain("<!--STUDIO-BLOCK:legalFooter:START-->");
    expect(html).toContain("<!--STUDIO-BLOCK:legalFooter:END-->");
  });

  // -------- Studio blocks con envelope "section" --------------------------

  it("envuelve `studio-callout` con sección Mustache", () => {
    const html = serialiseProjectToHtml(projectWithRoot("studio-callout"));
    expect(html).toContain("{{#cover.callout.text}}");
    expect(html).toContain("{{/cover.callout.text}}");
    expect(html).toContain('data-studio-block="callout"');
  });

  it("envuelve `studio-items-before` con sección Mustache", () => {
    const html = serialiseProjectToHtml(projectWithRoot("studio-items-before"));
    expect(html).toContain("{{#cover.instructions.items}}");
    expect(html).toContain("{{/cover.instructions.items}}");
  });

  it("envuelve `studio-items-after` con sección Mustache", () => {
    const html = serialiseProjectToHtml(projectWithRoot("studio-items-after"));
    expect(html).toContain("{{#cover.instructions.itemsAfter}}");
    expect(html).toContain("{{/cover.instructions.itemsAfter}}");
  });

  // -------- Genéricos ------------------------------------------------------

  it("renderiza `text` como <p> con contenido escapado", () => {
    const html = serialiseProjectToHtml(
      projectWithRoot("text", { tagName: "p", content: "Hola <mundo>" }),
    );
    // El `<` debe escaparse para defensa-en-profundidad (DOMPurify también
    // actuaría después, pero el walker escapa primero).
    expect(html).toContain("&lt;mundo&gt;");
    expect(html).toContain("<p");
  });

  it("renderiza `image` como <img>", () => {
    const html = serialiseProjectToHtml(
      projectWithRoot("image", { attributes: { src: "logo.png", alt: "Logo" } }),
    );
    expect(html).toContain("<img");
    expect(html).toContain('src="logo.png"');
    expect(html).toContain('alt="Logo"');
  });

  it("renderiza `divider` como <hr>", () => {
    const html = serialiseProjectToHtml(projectWithRoot("divider"));
    expect(html).toContain("<hr");
  });

  it("renderiza `two-column` como <div> con data-gjs-type", () => {
    const html = serialiseProjectToHtml(projectWithRoot("two-column"));
    expect(html).toContain("<div");
    expect(html).toContain('data-gjs-type="two-column"');
  });

  // -------- Defensa contra injection ---------------------------------------

  it("elimina handlers `on*` de los atributos", () => {
    const html = serialiseProjectToHtml(
      projectWithRoot("text", {
        tagName: "p",
        content: "test",
        attributes: { onclick: "alert(1)", class: "ok" },
      }),
    );
    expect(html).not.toMatch(/onclick/i);
    expect(html).toContain('class="ok"');
  });

  it("bloquea href javascript:", () => {
    const html = serialiseProjectToHtml(
      projectWithRoot("text", {
        tagName: "a",
        content: "click",
        attributes: { href: "javascript:alert(1)" },
      }),
    );
    expect(html).not.toMatch(/javascript:/i);
  });

  // -------- Errores ---------------------------------------------------------

  it("lanza MalformedCoverVisualError si el type es desconocido", () => {
    expect(() => serialiseProjectToHtml(projectWithRoot("studio-evil"))).toThrow(
      MalformedCoverVisualError,
    );
  });

  it("lanza MalformedCoverVisualError si no hay pages", () => {
    expect(() => serialiseProjectToHtml(toCoverVisualProject({}))).toThrow(
      MalformedCoverVisualError,
    );
  });

  it("lanza MalformedCoverVisualError si el JSON no es un objeto", () => {
    expect(() => serialiseProjectToHtml(toCoverVisualProject("string"))).toThrow(
      MalformedCoverVisualError,
    );
  });

  it("frame sin component no emite nada (auxiliares mobile/tablet)", () => {
    const project = toCoverVisualProject({
      pages: [{ id: "p1", frames: [{ id: "f1" }] }],
    });
    expect(() => serialiseProjectToHtml(project)).not.toThrow();
    const html = serialiseProjectToHtml(project);
    expect(html).toBe("");
  });
});
