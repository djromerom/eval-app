/**
 * Tests del resolver de imágenes para LaTeX export (L8 — sep 2026).
 * ==================================================================
 *
 * Cubre:
 *   • URL `/api/uploads/...` → inline con storagePath, ext, mime, uniqueName.
 *   • data: URI → skip.
 *   • http(s) → skip "external".
 *   • String vacío / non-string → skip "unknown".
 *   • URLs con traversal (`..`) → skip (storagePathFromUploadUrl filtra).
 *   • Mismo storagePath múltiples veces → uniqueName correlativo (img-1, img-2).
 *   • MIME por extensión (png, jpg, gif, webp, svg).
 */
import { describe, expect, it } from "vitest";
import {
  resolveImageSrc,
  type InlineImageRef,
} from "@/modules/latex-export/application/resolve-evaluation-image-buffer";

function isInline(r: ReturnType<typeof resolveImageSrc>): r is InlineImageRef {
  return r.kind === "inline";
}

describe("resolveImageSrc", () => {
  it("URL /api/uploads/ → inline con storagePath", () => {
    const seen = new Map<string, number>();
    const r = resolveImageSrc("/api/uploads/evaluations/inst-A/uuid-1.png", seen);
    expect(isInline(r)).toBe(true);
    if (!isInline(r)) return;
    expect(r.storagePath).toBe("evaluations/inst-A/uuid-1.png");
    expect(r.ext).toBe(".png");
    expect(r.mime).toBe("image/png");
    expect(r.uniqueName).toBe("img-1.png");
  });

  it("detecta extensión y MIME por tipo de archivo", () => {
    const seen = new Map<string, number>();
    const cases = [
      [".png", "image/png"],
      [".jpg", "image/jpeg"],
      [".jpeg", "image/jpeg"],
      [".gif", "image/gif"],
      [".webp", "image/webp"],
      [".svg", "image/svg+xml"],
    ] as const;
    for (const [ext, mime] of cases) {
      const r = resolveImageSrc(`/api/uploads/evaluations/i/uuid${ext}`, seen);
      expect(isInline(r)).toBe(true);
      if (!isInline(r)) return;
      expect(r.ext).toBe(ext);
      expect(r.mime).toBe(mime);
    }
  });

  it("URL /api/uploads/ con traversal `..` → skip (defensivo)", () => {
    const seen = new Map<string, number>();
    const r = resolveImageSrc("/api/uploads/../etc/passwd", seen);
    expect(r).toEqual({ kind: "skip", reason: "unknown" });
  });

  it("URL /api/uploads/ vacía → skip", () => {
    const seen = new Map<string, number>();
    const r = resolveImageSrc("/api/uploads/", seen);
    expect(r).toEqual({ kind: "skip", reason: "unknown" });
  });

  it("data: URI → skip reason 'data'", () => {
    const seen = new Map<string, number>();
    const r = resolveImageSrc("data:image/png;base64,iVBORw0KG=", seen);
    expect(r).toEqual({ kind: "skip", reason: "data" });
  });

  it("https:// → skip reason 'external'", () => {
    const seen = new Map<string, number>();
    const r = resolveImageSrc("https://cdn.example.com/img.png", seen);
    expect(r).toEqual({ kind: "skip", reason: "external" });
  });

  it("http:// → skip reason 'external'", () => {
    const seen = new Map<string, number>();
    const r = resolveImageSrc("http://example.com/img.png", seen);
    expect(r).toEqual({ kind: "skip", reason: "external" });
  });

  it("string vacío → skip reason 'unknown'", () => {
    const seen = new Map<string, number>();
    const r = resolveImageSrc("", seen);
    expect(r).toEqual({ kind: "skip", reason: "unknown" });
  });

  it("mismo storagePath llamado 2 veces → uniqueName img-1, img-2", () => {
    const seen = new Map<string, number>();
    const r1 = resolveImageSrc("/api/uploads/evaluations/i/uuid.png", seen);
    const r2 = resolveImageSrc("/api/uploads/evaluations/i/uuid.png", seen);
    expect(isInline(r1) && isInline(r2)).toBe(true);
    if (!isInline(r1) || !isInline(r2)) return;
    expect(r1.uniqueName).toBe("img-1.png");
    expect(r2.uniqueName).toBe("img-2.png");
    expect(seen.get("evaluations/i/uuid.png")).toBe(2);
  });

  it("storagePaths distintos → contador independiente, ambos img-1", () => {
    const seen = new Map<string, number>();
    const r1 = resolveImageSrc("/api/uploads/evaluations/i/uuid-A.png", seen);
    const r2 = resolveImageSrc("/api/uploads/evaluations/i/uuid-B.png", seen);
    expect(isInline(r1) && isInline(r2)).toBe(true);
    if (!isInline(r1) || !isInline(r2)) return;
    expect(r1.uniqueName).toBe("img-1.png");
    expect(r2.uniqueName).toBe("img-1.png");
    // Pero el storagePath difiere.
    expect(r1.storagePath).not.toBe(r2.storagePath);
  });

  it("extensión desconocida → mime fallback application/octet-stream", () => {
    const seen = new Map<string, number>();
    const r = resolveImageSrc("/api/uploads/evaluations/i/uuid.xyz", seen);
    expect(isInline(r)).toBe(true);
    if (!isInline(r)) return;
    expect(r.ext).toBe(".xyz");
    expect(r.mime).toBe("application/octet-stream");
  });
});
