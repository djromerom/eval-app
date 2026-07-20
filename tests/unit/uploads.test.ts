/**
 * Tests de las imágenes subidas al contenido de una evaluación.
 *
 * Lo crítico es el inlineado: el worker de PDF carga /print/... con un token
 * en la query string, así que las imágenes deben viajar dentro del documento
 * como data: URI o el examen sale impreso con recuadros rotos.
 */
import { describe, expect, it, vi } from "vitest";
import { renderRichText } from "@/components/editor/render";
import {
  inlineContentImages,
  inlineSectionsImages,
} from "@/modules/uploads/application/inline-content-images";
import {
  institutionIdFromPath,
  storagePathFromUploadUrl,
  uploadRelativePath,
} from "@/modules/uploads/domain/upload";

const read = async () => Buffer.from("PNGDATA");
const DATA_URI = `data:image/jpeg;base64,${Buffer.from("PNGDATA").toString("base64")}`;

/** Documento TipTap con una imagen del `src` dado. */
function docWithImage(src: string) {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "image", attrs: { src, alt: "x" } }] }],
  };
}

/** `src` de la primera imagen que encuentre en el documento. */
function firstImageSrc(doc: unknown): string | undefined {
  let found: string | undefined;
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    const r = n as Record<string, unknown>;
    if (r.type === "image") {
      found ??= (r.attrs as { src?: string } | undefined)?.src;
    }
    if (Array.isArray(r.content)) r.content.forEach(walk);
  };
  walk(doc);
  return found;
}

describe("storagePathFromUploadUrl", () => {
  it("extrae la ruta de una URL nuestra", () => {
    expect(storagePathFromUploadUrl("/api/uploads/evaluations/i1/abc.jpg")).toBe(
      "evaluations/i1/abc.jpg",
    );
  });

  it("ignora URLs externas, data: y valores no string", () => {
    expect(storagePathFromUploadUrl("https://ejemplo.com/foto.png")).toBeNull();
    expect(storagePathFromUploadUrl("data:image/png;base64,AAA")).toBeNull();
    expect(storagePathFromUploadUrl(undefined)).toBeNull();
    expect(storagePathFromUploadUrl(42)).toBeNull();
  });

  it("rechaza el path traversal", () => {
    expect(storagePathFromUploadUrl("/api/uploads/../../etc/passwd")).toBeNull();
    expect(storagePathFromUploadUrl("/api/uploads/evaluations/i1/../../secreto")).toBeNull();
  });

  it("rechaza el prefijo sin ruta", () => {
    expect(storagePathFromUploadUrl("/api/uploads/")).toBeNull();
  });
});

describe("institutionIdFromPath", () => {
  it("devuelve el tenant de una ruta bien formada", () => {
    expect(institutionIdFromPath("evaluations/inst-1/foto.jpg")).toBe("inst-1");
    expect(institutionIdFromPath(uploadRelativePath("inst-9", "abc"))).toBe("inst-9");
  });

  it("devuelve null si la ruta no tiene la forma esperada", () => {
    expect(institutionIdFromPath("otra-cosa/inst-1/foto.jpg")).toBeNull();
    expect(institutionIdFromPath("evaluations/foto.jpg")).toBeNull();
    expect(institutionIdFromPath("")).toBeNull();
  });
});

describe("inlineContentImages", () => {
  it("sustituye el src de una imagen nuestra por su data: URI", async () => {
    const out = await inlineContentImages(docWithImage("/api/uploads/evaluations/i1/a.jpg"), read);
    expect(firstImageSrc(out)).toBe(DATA_URI);
  });

  it("conserva los demás atributos de la imagen", async () => {
    const out = await inlineContentImages(docWithImage("/api/uploads/evaluations/i1/a.jpg"), read);
    const img = (out as { content: { content: { attrs: Record<string, unknown> }[] }[] })
      .content[0]!.content[0]!;
    expect(img.attrs.alt).toBe("x");
  });

  it("deja intacta una imagen externa", async () => {
    const src = "https://ejemplo.com/foto.png";
    const out = await inlineContentImages(docWithImage(src), read);
    expect(firstImageSrc(out)).toBe(src);
  });

  it("si el archivo no está en disco conserva el src en vez de romper el render", async () => {
    const falla = async () => {
      throw new Error("ENOENT");
    };
    const src = "/api/uploads/evaluations/i1/borrada.jpg";
    const out = await inlineContentImages(docWithImage(src), falla);
    expect(firstImageSrc(out)).toBe(src);
  });

  it("lee del disco una sola vez aunque la imagen se repita", async () => {
    const spy = vi.fn(read);
    const src = "/api/uploads/evaluations/i1/a.jpg";
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "image", attrs: { src } }] },
        { type: "paragraph", content: [{ type: "image", attrs: { src } }] },
      ],
    };
    await inlineContentImages(doc, spy);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("no muta el documento original", async () => {
    const doc = docWithImage("/api/uploads/evaluations/i1/a.jpg");
    const antes = JSON.stringify(doc);
    await inlineContentImages(doc, read);
    expect(JSON.stringify(doc)).toBe(antes);
  });

  it("tolera documentos vacíos o sin imágenes", async () => {
    expect(await inlineContentImages(null, read)).toBeNull();
    expect(await inlineContentImages("texto plano", read)).toBe("texto plano");
    const sinImagen = { type: "doc", content: [{ type: "paragraph" }] };
    expect(await inlineContentImages(sinImagen, read)).toEqual(sinImagen);
  });
});

describe("inlineSectionsImages", () => {
  it("alcanza el contexto, el enunciado y las opciones", async () => {
    const src = "/api/uploads/evaluations/i1/a.jpg";
    const sections = [
      {
        content: docWithImage(src),
        questions: [{ text: docWithImage(src), options: [{ text: docWithImage(src) }] }],
      },
    ];

    const [out] = await inlineSectionsImages(sections, read);

    expect(firstImageSrc(out!.content)).toBe(DATA_URI);
    expect(firstImageSrc(out!.questions[0]!.text)).toBe(DATA_URI);
    expect(firstImageSrc(out!.questions[0]!.options[0]!.text)).toBe(DATA_URI);
  });

  it("conserva los campos que no son contenido rico", async () => {
    const sections = [
      {
        content: null,
        order: 3,
        questions: [{ text: null, number: 7, correctAnswer: "B", options: [] }],
      },
    ];
    const [out] = await inlineSectionsImages(sections, read);
    expect(out!.order).toBe(3);
    expect(out!.questions[0]!.number).toBe(7);
    expect(out!.questions[0]!.correctAnswer).toBe("B");
  });
});

/**
 * El ancho que el docente fija arrastrando se guarda en el JSON y debe llegar
 * hasta el HTML que renderiza el servidor para el PDF. Si se perdiera por el
 * camino, la imagen saldría impresa a tamaño completo.
 */
describe("ancho de imagen (redimensión)", () => {
  it("emite el ancho como style y data-width al renderizar en servidor", () => {
    const html = renderRichText({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "image", attrs: { src: "/api/uploads/evaluations/i1/a.jpg", width: 60 } },
          ],
        },
      ],
    });
    // `width="60%"` y no `style`: el DOM del servidor sanitiza `style`.
    expect(html).toContain('width="60%"');
    expect(html).toContain('data-width="60"');
  });

  it("una imagen sin ancho no emite style (queda al 100% por CSS)", () => {
    const html = renderRichText({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "image", attrs: { src: "/api/uploads/evaluations/i1/a.jpg" } }],
        },
      ],
    });
    expect(html).not.toContain("width=");
    expect(html).not.toContain("data-width");
  });

  it("el ancho sobrevive al inlineado de la imagen", async () => {
    // Regresión: el inlineador reconstruye `attrs` al cambiar el src; si
    // hiciera `attrs = { src }` en vez de extender, borraría el ancho y la
    // imagen saldría a tamaño completo en el PDF.
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "image", attrs: { src: "/api/uploads/evaluations/i1/a.jpg", width: 45 } },
          ],
        },
      ],
    };
    const out = (await inlineContentImages(doc, read)) as {
      content: { content: { attrs: Record<string, unknown> }[] }[];
    };
    const attrs = out.content[0]!.content[0]!.attrs;
    expect(attrs.width).toBe(45);
    expect(attrs.src).toBe(DATA_URI);
  });
});
