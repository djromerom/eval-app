/**
 * Tests del helper `inlineHtmlImages` (ago 2026).
 * ================================================
 *
 * Convierte `<img src="/api/uploads/...">` en `<img src="data:image/svg+xml;base64,...">`
 * para que el iframe sandbox="" y el PDF de Puppeteer puedan renderizar
 * SVGs extraídos sin auth. Valida:
 *
 *   • Happy path: HTML con 1 img, múltiples imgs.
 *   • Edge cases: HTML sin imgs, src no-uploads, archivo borrado.
 *   • Cache por path: el mismo archivo se lee una sola vez.
 *   • Walk por índices: imgs idénticos repetidos no se confunden.
 */
import { describe, expect, it } from "vitest";
import {
  inlineHtmlImages,
  type ReadUpload,
} from "@/modules/cover-html/application/inline-html-images";

// In-memory double del `read` — opcionalmente falla para simular ENOENT.
function makeRead(opts: { missing?: Set<string> } = {}) {
  const hits = new Map<string, number>();
  const read: ReadUpload = async (relativePath) => {
    hits.set(relativePath, (hits.get(relativePath) ?? 0) + 1);
    if (opts.missing?.has(relativePath)) {
      throw new Error("ENOENT");
    }
    return Buffer.from(`<svg>${relativePath}</svg>`, "utf8");
  };
  return { read, hits };
}

describe("inlineHtmlImages", () => {
  it("HTML sin imgs devuelve html intacto", async () => {
    const html = "<p>Solo texto</p><h1>Título</h1>";
    const { read, hits } = makeRead();

    const result = await inlineHtmlImages(html, { read });

    expect(result).toBe(html);
    expect(hits.size).toBe(0);
  });

  it("sustituye 1 <img src='/api/uploads/...'> por data URL", async () => {
    const path = "institutions/inst-A/cover-html/b1/abc123.svg";
    const url = `/api/uploads/${path}`;
    const html = `<p>Antes</p><img src="${url}" alt="" class="x"/><p>Fin</p>`;
    const { read } = makeRead();

    const result = await inlineHtmlImages(html, { read });

    expect(result).toContain('<img src="data:image/svg+xml;base64,');
    expect(result).not.toContain(url);
    expect(result).toContain('class="x"');
    expect(result).toContain("<p>Antes</p>");
    expect(result).toContain("<p>Fin</p>");
  });

  it("deja intactos los src que NO son /api/uploads/", async () => {
    const html = `<img src="https://example.com/foo.svg" alt=""/>
<img src="data:image/png;base64,AAA" alt=""/>
<img src="/static/local.png" alt=""/>`;
    const { read } = makeRead();

    const result = await inlineHtmlImages(html, { read });

    expect(result).toBe(html);
  });

  it("lee el mismo archivo una sola vez si está repetido (cache)", async () => {
    const path = "institutions/inst-A/cover-html/b1/shared.svg";
    const url = `/api/uploads/${path}`;
    const html = `<img src="${url}"/><img src="${url}"/><img src="${url}"/>`;
    const { read, hits } = makeRead();

    await inlineHtmlImages(html, { read });

    expect(hits.get(path)).toBe(1);
  });

  it("imgs idénticos repetidos se sustituyen cada uno por SU data URL", async () => {
    // Edge case crítico: dos `<img>` con el MISMO src (cache hit) deben
    // ambos terminar como data URL — NO queremos que solo uno se
    // sustituya y el otro quede con el src original.
    const path = "institutions/inst-A/cover-html/b1/rep.svg";
    const url = `/api/uploads/${path}`;
    const html = `<img src="${url}" alt="1"/><img src="${url}" alt="2"/>`;
    const { read } = makeRead();

    const result = await inlineHtmlImages(html, { read });

    expect(result).not.toContain(url);
    expect((result.match(/data:image\/svg\+xml;base64,/g) ?? []).length).toBe(2);
    expect(result).toContain('alt="1"');
    expect(result).toContain('alt="2"');
  });

  it("mezcla imgs uploads + externos: solo uploads se inlean", async () => {
    const path = "institutions/inst-A/cover-html/b1/x.svg";
    const html = `<img src="/api/uploads/${path}"/>
    <img src="https://cdn.example.com/y.png"/>`;
    const { read, hits } = makeRead();

    const result = await inlineHtmlImages(html, { read });

    expect(result).toContain("data:image/svg+xml;base64,");
    expect(result).toContain("https://cdn.example.com/y.png");
    expect(hits.has(path)).toBe(true);
  });

  it("si el archivo falta en disco, conserva el src original", async () => {
    const path = "institutions/inst-A/cover-html/b1/missing.svg";
    const url = `/api/uploads/${path}`;
    const html = `<img src="${url}" alt=""/>`;
    const { read } = makeRead({ missing: new Set([path]) });

    const result = await inlineHtmlImages(html, { read });

    // El src original se mantiene (mejor img rota que ninguna).
    expect(result).toContain(url);
    expect(result).not.toContain("data:image/svg+xml");
  });

  it("NO usa /api/uploads/ como prefijo si el src lo contiene en otra parte del atributo", async () => {
    // Edge case: el src es '/static/api/uploads/foo.png' — NO debe inlearse.
    const html = `<img src="/static/api/uploads/foo.png" alt=""/>`;
    const { read, hits } = makeRead();

    const result = await inlineHtmlImages(html, { read });

    expect(result).toBe(html);
    expect(hits.size).toBe(0);
  });

  it("preserva atributos distintos en el <img>", async () => {
    const path = "institutions/inst-A/cover-html/b1/styled.svg";
    const url = `/api/uploads/${path}`;
    const html = `<img src="${url}" alt="icon" width="32" height="32" class="icon-x" style="margin:4px"/>`;
    const { read } = makeRead();

    const result = await inlineHtmlImages(html, { read });

    expect(result).toContain('alt="icon"');
    expect(result).toContain('width="32"');
    expect(result).toContain('height="32"');
    expect(result).toContain('class="icon-x"');
    expect(result).toContain('style="margin:4px"');
    expect(result).toContain("data:image/svg+xml;base64,");
  });
});
