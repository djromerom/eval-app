/**
 * Tests del helper `extractInlineAssets` (ago 2026).
 * ===================================================
 *
 * Helper que toma el HTML de la portada, mueve los assets inline
 * (SVGs vectoriales + imágenes base64 en `<img>`) a disco y los
 * reemplaza por `<img src="/api/uploads/...">`. Valida:
 *
 *   • Happy path: SVGs, imágenes base64 (PNG/JPEG/GIF/WebP/SVG), mix.
 *   • Edge cases: HTML sin assets, SVG vacío, base64 con caracteres especiales.
 *   • Caps: MAX_ASSETS_PER_SAVE, MAX_ASSET_BYTES.
 *   • Idempotencia (segunda llamada sobre HTML ya slimmed).
 *   • Orden de aparición preservado.
 */
import { describe, expect, it } from "vitest";
import {
  extractInlineAssets,
  MAX_ASSET_BYTES,
  MAX_ASSETS_PER_SAVE,
  OversizedInlineAssetError,
  TooManyInlineAssetsError,
  type WriteUpload,
} from "@/modules/cover-html/application/extract-inline-assets";

function makeSave() {
  const saved: Array<{ path: string; data: Buffer }> = [];
  const save: WriteUpload = async (relativePath, data) => {
    saved.push({ path: relativePath, data });
    return relativePath;
  };
  return { save, saved };
}

describe("extractInlineAssets", () => {
  // ========================================================================
  // SVG path
  // ========================================================================

  it("HTML sin assets devuelve html intacto y extractedAssets=[]", async () => {
    const html = "<h1>Hola</h1><p>Mundo sin svg ni imágenes</p>";
    const { save, saved } = makeSave();

    const result = await extractInlineAssets(html, {
      institutionId: "inst-A",
      bundleId: "b1",
      save,
    });

    expect(result.html).toBe(html);
    expect(result.extractedAssets).toEqual([]);
    expect(saved).toHaveLength(0);
  });

  it("extrae 1 SVG y lo reemplaza por <img>", async () => {
    const svg = '<svg width="24" height="24"><circle cx="12" cy="12" r="10"/></svg>';
    const html = `<h1>Título</h1>${svg}<p>Después</p>`;
    const { save, saved } = makeSave();

    const result = await extractInlineAssets(html, {
      institutionId: "inst-A",
      bundleId: "b1",
      save,
    });

    expect(result.extractedAssets).toHaveLength(1);
    expect(result.extractedAssets[0]!).toMatch(
      /^institutions\/inst-A\/cover-html\/b1\/[\w-]+\.svg$/,
    );
    expect(result.html).toContain('<img src="/api/uploads/');
    expect(result.html).toContain('class="cover-html-extracted-asset"');
    expect(result.html).not.toContain("<svg");
    expect(result.html).toContain("<h1>Título</h1>");

    expect(saved).toHaveLength(1);
    expect(saved[0]!.data.toString("utf8")).toBe(svg);
    expect(saved[0]!.path).toBe(result.extractedAssets[0]);
  });

  it("extrae múltiples SVGs preservando orden de aparición", async () => {
    const svg1 = '<svg width="10"><rect/></svg>';
    const svg2 = '<svg width="20"><path d="M0 0"/></svg>';
    const svg3 = '<svg width="30"><line x1="0" y1="0" x2="1" y2="1"/></svg>';
    const html = `<p>A</p>${svg1}<p>B</p>${svg2}<p>C</p>${svg3}<p>D</p>`;
    const { save, saved } = makeSave();

    const result = await extractInlineAssets(html, {
      institutionId: "inst-A",
      bundleId: "b1",
      save,
    });

    expect(result.extractedAssets).toHaveLength(3);
    expect(new Set(result.extractedAssets).size).toBe(3);
    expect((result.html.match(/<img src=/g) ?? []).length).toBe(3);
    expect(result.html).not.toContain("<svg");

    expect(saved).toHaveLength(3);
    expect(saved[0]!.data.toString("utf8")).toBe(svg1);
    expect(saved[1]!.data.toString("utf8")).toBe(svg2);
    expect(saved[2]!.data.toString("utf8")).toBe(svg3);
  });

  // ========================================================================
  // Imágenes base64 path (ago 2026 — el caso real del docente)
  // ========================================================================

  it("extrae 1 imagen PNG base64 y la reemplaza por <img>", async () => {
    // 1x1 PNG transparente en base64 (~70 bytes decoded)
    const base64Data =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const dataUri = `data:image/png;base64,${base64Data}`;
    const html = `<h1>Foto</h1><img src="${dataUri}" alt="logo" class="big"/>`;
    const { save, saved } = makeSave();

    const result = await extractInlineAssets(html, {
      institutionId: "inst-A",
      bundleId: "b1",
      save,
    });

    expect(result.extractedAssets).toHaveLength(1);
    expect(result.extractedAssets[0]!).toMatch(/\.png$/);
    expect(result.html).toContain('<img src="/api/uploads/');
    expect(result.html).toContain('class="big"'); // preserva atributos
    expect(result.html).toContain('alt="logo"');
    expect(result.html).not.toContain("data:image/png");

    // El archivo guardado debe ser el binario decodificado, NO base64.
    expect(saved).toHaveLength(1);
    expect(saved[0]!.path).toMatch(/\.png$/);
    expect(saved[0]!.data.toString("base64")).toBe(base64Data);
  });

  it("extrae imágenes JPEG, GIF y WebP con extensión correcta", async () => {
    const jpegUri = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQA=";
    const gifUri = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    const webpUri =
      "data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJZQCdAEO/gbsAAA=";
    const html = `<img src="${jpegUri}"/><img src="${gifUri}"/><img src="${webpUri}"/>`;
    const { save, saved } = makeSave();

    const result = await extractInlineAssets(html, {
      institutionId: "inst-A",
      bundleId: "b1",
      save,
    });

    expect(result.extractedAssets).toHaveLength(3);
    expect(result.extractedAssets[0]!).toMatch(/\.jpg$/);
    expect(result.extractedAssets[1]!).toMatch(/\.gif$/);
    expect(result.extractedAssets[2]!).toMatch(/\.webp$/);
    expect(result.html).not.toContain("data:image/");
    expect(saved).toHaveLength(3);
  });

  it("extrae SVG dentro de <img src='data:image/svg+xml;base64,...'> como .svg", async () => {
    const svgText = "<svg><circle/></svg>";
    const svgBase64 = Buffer.from(svgText).toString("base64");
    const svgDataUri = `data:image/svg+xml;base64,${svgBase64}`;
    const html = `<img src="${svgDataUri}" alt="svg-img"/>`;
    const { save, saved } = makeSave();

    const result = await extractInlineAssets(html, {
      institutionId: "inst-A",
      bundleId: "b1",
      save,
    });

    expect(result.extractedAssets).toHaveLength(1);
    expect(result.extractedAssets[0]!).toMatch(/\.svg$/);
    expect(saved[0]!.data.toString("utf8")).toBe(svgText);
  });

  it("mezcla SVG inline + <img base64> + <img src='/static/...'>, solo extrae los inline", async () => {
    const svg = "<svg><rect/></svg>";
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const pngUri = `data:image/png;base64,${pngBase64}`;
    const html = `<div>
      ${svg}
      <img src="${pngUri}"/>
      <img src="/static/keep.png"/>
      <img src="https://cdn.example.com/keep.png"/>
    </div>`;
    const { save, saved } = makeSave();

    const result = await extractInlineAssets(html, {
      institutionId: "inst-A",
      bundleId: "b1",
      save,
    });

    // Solo extrae el SVG y la PNG inline. Las externas se quedan.
    expect(result.extractedAssets).toHaveLength(2);
    expect(saved).toHaveLength(2);
    expect(result.html).toContain("/static/keep.png");
    expect(result.html).toContain("https://cdn.example.com/keep.png");
    expect(result.html).toContain('<img src="/api/uploads/');
    expect(result.html).not.toContain("<svg");
    expect(result.html).not.toContain("data:image/png");
  });

  it("intercala SVG y <img base64> preservando orden de aparición", async () => {
    const svg1 = '<svg width="10"><rect/></svg>';
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const pngUri = `data:image/png;base64,${pngBase64}`;
    const svg2 = '<svg width="20"><path/></svg>';
    const html = `${svg1}<p>X</p><img src="${pngUri}"/><p>Y</p>${svg2}`;
    const { save, saved } = makeSave();

    const result = await extractInlineAssets(html, {
      institutionId: "inst-A",
      bundleId: "b1",
      save,
    });

    expect(result.extractedAssets).toHaveLength(3);
    expect(saved).toHaveLength(3);
    expect(saved[0]!.data.toString("utf8")).toBe(svg1);
    expect(saved[1]!.data.toString("base64")).toBe(pngBase64);
    expect(saved[2]!.data.toString("utf8")).toBe(svg2);
  });

  // ========================================================================
  // Caps + edge cases
  // ========================================================================

  it("rechaza si supera MAX_ASSETS_PER_SAVE", async () => {
    const svgs = Array.from(
      { length: MAX_ASSETS_PER_SAVE + 1 },
      (_, i) => `<svg width="${i}"><rect/></svg>`,
    ).join("");
    const html = `<p>${svgs}</p>`;
    const { save, saved } = makeSave();

    await expect(
      extractInlineAssets(html, { institutionId: "inst-A", bundleId: "b1", save }),
    ).rejects.toThrow(TooManyInlineAssetsError);

    expect(saved).toHaveLength(0);
  });

  it("rechaza si UN SVG supera MAX_ASSET_BYTES", async () => {
    const huge = '<svg width="10">' + "a".repeat(MAX_ASSET_BYTES) + "</svg>";
    const html = `<p>${huge}</p>`;
    const { save, saved } = makeSave();

    await expect(
      extractInlineAssets(html, { institutionId: "inst-A", bundleId: "b1", save }),
    ).rejects.toThrow(OversizedInlineAssetError);

    expect(saved).toHaveLength(0);
  });

  it("rechaza si UNA imagen base64 decodificada supera MAX_ASSET_BYTES", async () => {
    // Base64 decodifica 4 chars → 3 bytes. Para superar MAX_ASSET_BYTES
    // (1MB) decoded necesitamos > 1_000_000 * 4 / 3 ≈ 1.33M chars.
    // Usamos 1.6M chars de 'a' (válido como base64 padding) para tener
    // margen y que la prueba sea robusta a cambios de cap.
    const hugeBase64 = "a".repeat(1_600_000);
    const uri = `data:image/png;base64,${hugeBase64}`;
    const html = `<img src="${uri}"/>`;
    const { save, saved } = makeSave();

    await expect(
      extractInlineAssets(html, { institutionId: "inst-A", bundleId: "b1", save }),
    ).rejects.toThrow(OversizedInlineAssetError);

    expect(saved).toHaveLength(0);
  });

  it("acepta exactamente MAX_ASSETS_PER_SAVE assets combinados", async () => {
    const pngBase64 = "iVBORw0KGgo=";
    const items = Array.from(
      { length: MAX_ASSETS_PER_SAVE / 2 },
      (_, i) => `<svg width="${i}"><rect/></svg><img src="data:image/png;base64,${pngBase64}"/>`,
    ).join("");
    const html = `<p>${items}</p>`;
    const { save, saved } = makeSave();

    const result = await extractInlineAssets(html, {
      institutionId: "inst-A",
      bundleId: "b1",
      save,
    });

    expect(result.extractedAssets).toHaveLength(MAX_ASSETS_PER_SAVE);
    expect(saved).toHaveLength(MAX_ASSETS_PER_SAVE);
  });

  it("idempotencia: llamar dos veces sobre HTML ya slimmed no extrae más", async () => {
    const svg = '<svg width="24"><circle/></svg>';
    const pngUri = "data:image/png;base64,iVBORw0KGgo=";
    const { save, saved } = makeSave();
    const first = await extractInlineAssets(`<p>${svg}<img src="${pngUri}"/></p>`, {
      institutionId: "inst-A",
      bundleId: "b1",
      save,
    });
    expect(first.extractedAssets).toHaveLength(2);

    const second = await extractInlineAssets(first.html, {
      institutionId: "inst-A",
      bundleId: "b1",
      save,
    });
    expect(second.extractedAssets).toEqual([]);
    expect(second.html).toBe(first.html);
    expect(saved).toHaveLength(2);
  });

  it("usa institutionId y bundleId del contexto en el path", async () => {
    const svg = '<svg width="10"><rect/></svg>';
    const { save } = makeSave();
    const result = await extractInlineAssets(`<p>${svg}</p>`, {
      institutionId: "inst-XYZ",
      bundleId: "bundle-42",
      save,
    });

    expect(result.extractedAssets[0]!).toMatch(
      /^institutions\/inst-XYZ\/cover-html\/bundle-42\/[\w-]+\.svg$/,
    );
  });
});
