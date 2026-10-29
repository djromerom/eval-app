/**
 * Contenido "protegido" de un documento TipTap.
 *
 * La IA solo revisa TEXTO. Las fórmulas LaTeX (`inlineMath` / `blockMath`),
 * las imágenes, las tablas y las listas no se revisan ni se corrigen: son
 * átomos que el modelo no puede reinterpretar sin romperlos.
 *
 * El truco es esconderlos detrás de marcadores (`⟦F1⟧`, `⟦I1⟧`, `⟦B1⟧`)
 * que la IA ve como texto. Cuando el docente elige "Corregirlo", el
 * documento se reconstruye desde el texto corregido y los nodos originales
 * se re-inyectan en el lugar del marcador.
 *
 * Todo es puro (sin React, sin Prisma, sin dependencias) para poder
 * testearlo en Node.
 */

/** Nodo TipTap que vive DENTRO de un párrafo (inline). */
const INLINE_PROTECTED_TYPES = new Set(["inlineMath"]);

/** Tipo de nodo protegido → clase del marcador. */
const PROTECTED_KIND: Record<string, "formula" | "imagen" | "bloque"> = {
  inlineMath: "formula",
  blockMath: "formula",
  image: "imagen",
};

export interface ProtectedElement {
  /** Marcador visible en el texto que ve la IA: ⟦F1⟧, ⟦I1⟧, ⟦B1⟧. */
  token: string;
  /** "formula" | "imagen" | "bloque". */
  tipo: "formula" | "imagen" | "bloque";
  /** "inline" si vive dentro de un párrafo; "bloque" si es hermano de los párrafos. */
  nivel: "inline" | "bloque";
  /** Contexto legible para la IA (LaTeX de la fórmula, alt de la imagen, texto del bloque). */
  contexto: string;
  /** Nodo TipTap original (se re-inyecta al aplicar la corrección). */
  node: unknown;
}

/** Acumulador de elementos protegidos de un ítem (numeración global). */
export interface ProtectedRegistry {
  elementos: ProtectedElement[];
  formulas: number;
  imagenes: number;
  bloques: number;
}

export function createProtectedRegistry(): ProtectedRegistry {
  return { elementos: [], formulas: 0, imagenes: 0, bloques: 0 };
}

const TOKEN_RE = /⟦[A-Z]\d+⟧/g;

/** Devuelve los marcadores que aparecen en un texto. */
export function tokensIn(text: string): string[] {
  return text.match(TOKEN_RE) ?? [];
}

function nextToken(tipo: "formula" | "imagen" | "bloque", registry: ProtectedRegistry): string {
  if (tipo === "formula") {
    registry.formulas += 1;
    return `⟦F${registry.formulas}⟧`;
  }
  if (tipo === "imagen") {
    registry.imagenes += 1;
    return `⟦I${registry.imagenes}⟧`;
  }
  registry.bloques += 1;
  return `⟦B${registry.bloques}⟧`;
}

/** Texto legible de un nodo (para darle contexto a la IA). */
function nodePlainText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { text?: unknown; content?: unknown; attrs?: Record<string, unknown> };
  if (typeof n.text === "string") return n.text;
  if (Array.isArray(n.content)) {
    return n.content
      .map((c) => nodePlainText(c))
      .filter((s) => s.length > 0)
      .join(" ");
  }
  return "";
}

/** Contexto legible de un nodo protegido. */
function protectedContext(node: unknown, tipo: "formula" | "imagen" | "bloque"): string {
  const attrs =
    node && typeof node === "object"
      ? ((node as { attrs?: Record<string, unknown> }).attrs ?? {})
      : {};
  if (tipo === "formula") {
    const tex = typeof attrs.tex === "string" ? attrs.tex : "";
    return tex ? `fórmula: ${tex}` : "fórmula";
  }
  if (tipo === "imagen") {
    const alt = typeof attrs.alt === "string" ? attrs.alt.trim() : "";
    return alt ? `imagen: ${alt}` : "imagen";
  }
  const text = nodePlainText(node).replace(/\s+/g, " ").trim();
  return text ? `bloque: ${text}` : "bloque";
}

/**
 * Recorre un documento TipTap y devuelve su texto plano, reemplazando
 * cada nodo protegido por un marcador y acumulándolo en el registro.
 */
export function extractProtectedText(doc: unknown, registry: ProtectedRegistry): string {
  if (doc === null || doc === undefined) return "";
  if (typeof doc === "string") return doc;
  if (typeof doc !== "object") return "";

  const walk = (node: unknown): string => {
    if (!node || typeof node !== "object") return "";
    const n = node as { type?: unknown; text?: unknown; content?: unknown };
    const type = typeof n.type === "string" ? n.type : "";

    if (type === "text") return typeof n.text === "string" ? n.text : "";
    if (type === "hardBreak") return "\n";
    if (type === "paragraph") {
      const children = Array.isArray(n.content) ? n.content : [];
      return children.map((c) => walk(c)).join("");
    }
    if (type === "doc") {
      const children = Array.isArray(n.content) ? n.content : [];
      return children.map((c) => walk(c)).join("\n");
    }

    // Nodo protegido: se reemplaza por un marcador.
    const kind = PROTECTED_KIND[type] ?? "bloque";
    const nivel = INLINE_PROTECTED_TYPES.has(type) ? "inline" : "bloque";
    const token = nextToken(kind, registry);
    registry.elementos.push({
      token,
      tipo: kind,
      nivel,
      contexto: protectedContext(node, kind),
      node,
    });
    return token;
  };

  return walk(doc);
}

type Segment = { kind: "texto"; value: string } | { kind: "elemento"; el: ProtectedElement };

/**
 * Reconstruye un documento TipTap a partir del texto corregido por la IA,
 * re-inyectando los nodos protegidos en el lugar de su marcador.
 *
 * `esperados` son los marcadores que tenía el texto ORIGINAL de este
 * campo: si la IA se comió alguno, el nodo se re-agrega al final (perder
 * una imagen o una fórmula sería peor que un orden raro).
 */
export function rebuildProtectedDoc(
  texto: string,
  registry: ProtectedRegistry,
  esperados: string[] = [],
): { type: "doc"; content: unknown[] } {
  const porToken = new Map(registry.elementos.map((e) => [e.token, e]));

  const segmentos: Segment[] = [];
  let ultimo = 0;
  for (const match of texto.matchAll(TOKEN_RE)) {
    const token = match[0];
    const el = porToken.get(token);
    if (!el) continue; // marcador desconocido → queda como texto
    if (match.index !== undefined && match.index > ultimo) {
      segmentos.push({ kind: "texto", value: texto.slice(ultimo, match.index) });
    }
    segmentos.push({ kind: "elemento", el });
    ultimo = (match.index ?? 0) + token.length;
  }
  if (ultimo < texto.length) segmentos.push({ kind: "texto", value: texto.slice(ultimo) });

  const bloques: unknown[] = [];
  let inline: unknown[] = [];

  const flush = () => {
    if (inline.length > 0) {
      bloques.push({ type: "paragraph", content: inline });
      inline = [];
    }
  };

  for (const seg of segmentos) {
    if (seg.kind === "texto") {
      const partes = seg.value.split("\n");
      partes.forEach((parte, i) => {
        if (i > 0) flush();
        if (parte.length > 0) inline.push({ type: "text", text: parte });
      });
      continue;
    }
    if (seg.el.nivel === "inline") {
      inline.push(seg.el.node);
    } else {
      flush();
      bloques.push(seg.el.node);
    }
  }
  flush();

  // Marcadores que la IA no devolvió: re-agregamos el nodo original.
  const usados = new Set(tokensIn(texto));
  for (const token of esperados) {
    if (usados.has(token)) continue;
    const el = porToken.get(token);
    if (!el) continue;
    console.warn(
      `[ai-review] la IA omitió el marcador ${token} — se re-inyecta el elemento original`,
    );
    if (el.nivel === "inline") inline.push(el.node);
    else bloques.push(el.node);
  }
  flush();

  if (bloques.length === 0) bloques.push({ type: "paragraph", content: [] });
  return { type: "doc", content: bloques };
}
