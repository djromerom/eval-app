import { storagePathFromUploadUrl } from "../domain/upload";

/** Lee un archivo del almacenamiento. Se inyecta para poder testear sin disco. */
export type ReadUpload = (relativePath: string) => Promise<Buffer>;

/**
 * Sustituye, dentro de un documento TipTap, el `src` de cada imagen servida
 * por `/api/uploads/` por un `data:` URI con su contenido.
 *
 * Por qué hace falta: el PDF lo genera el worker cargando `/print/...?t=token`
 * con Puppeteer. Ese token va en la query string de la PÁGINA; las imágenes
 * serían peticiones aparte, sin sesión ni token, y saldrían rotas en el
 * examen impreso. Incrustarlas hace que el documento sea autocontenido, y
 * funciona igual en el Ctrl+P del navegador.
 *
 * Las imágenes que no son nuestras (una `https://` externa, o ya un `data:`)
 * se dejan intactas. Si un archivo falta en disco se deja el `src` original en
 * vez de romper el render completo: mejor un examen con una imagen rota que
 * ningún examen.
 */
export async function inlineContentImages(doc: unknown, read: ReadUpload): Promise<unknown> {
  if (!doc || typeof doc !== "object") return doc;

  // Cachea por ruta: la misma imagen puede repetirse en varias preguntas y
  // leerla del disco una sola vez ahorra I/O en exámenes largos.
  //
  // Se guarda la PROMESA, no el valor resuelto: el recorrido usa Promise.all,
  // así que dos ramas con la misma imagen consultan la caché antes de que
  // ninguna haya terminado de leer. Cachear el valor las dejaba leer a ambas.
  const cache = new Map<string, Promise<string | null>>();

  function dataUriFor(relative: string): Promise<string | null> {
    const hit = cache.get(relative);
    if (hit) return hit;
    const pending = read(relative)
      .then((buf) => `data:image/jpeg;base64,${buf.toString("base64")}`)
      .catch(() => null); // falta en disco: se conserva el src original
    cache.set(relative, pending);
    return pending;
  }

  async function walk(node: unknown): Promise<unknown> {
    if (Array.isArray(node)) {
      return Promise.all(node.map(walk));
    }
    if (!node || typeof node !== "object") return node;

    const record = node as Record<string, unknown>;
    const next: Record<string, unknown> = { ...record };

    if (record.type === "image") {
      const attrs = record.attrs as Record<string, unknown> | undefined;
      const relative = storagePathFromUploadUrl(attrs?.src);
      if (relative) {
        const dataUri = await dataUriFor(relative);
        if (dataUri) next.attrs = { ...attrs, src: dataUri };
      }
    }

    if (Array.isArray(record.content)) {
      next.content = await Promise.all(record.content.map(walk));
    }
    return next;
  }

  return walk(doc);
}

/** Forma mínima que necesita `inlineSectionsImages` de cada contexto. */
interface SectionLike {
  content: unknown;
  questions: Array<{ text: unknown; options: Array<{ text: unknown }> }>;
}

/**
 * Aplica `inlineContentImages` a todo el contenido rico de unos contextos:
 * el texto del contexto, el enunciado de cada pregunta y cada opción.
 *
 * Devuelve copias; no muta lo que recibe. Los campos que no son contenido
 * rico (número, clave, metadatos) se conservan tal cual.
 */
export async function inlineSectionsImages<T extends SectionLike>(
  sections: T[],
  read: ReadUpload,
): Promise<T[]> {
  return Promise.all(
    sections.map(async (section) => ({
      ...section,
      content: await inlineContentImages(section.content, read),
      questions: await Promise.all(
        section.questions.map(async (q) => ({
          ...q,
          text: await inlineContentImages(q.text, read),
          options: await Promise.all(
            q.options.map(async (o) => ({
              ...o,
              text: await inlineContentImages(o.text, read),
            })),
          ),
        })),
      ),
    })),
  );
}
