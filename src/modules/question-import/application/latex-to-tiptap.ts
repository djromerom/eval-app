/**
 * Convierte un texto plano que puede contener fórmulas LaTeX delimitadas
 * por `$...$` (inline) y `$$...$$` (bloque) en una lista de nodos TipTap:
 *
 *   - `$$...$$` → nodo top-level `blockMath` con atributo `tex`.
 *   - `$...$`   → nodo `inlineMath` (atributo `tex`) intercalado dentro de
 *     un `paragraph` junto con el texto circundante.
 *   - Lo demás  → nodos `text` dentro del `paragraph`.
 *
 * El parser es PURO: no toca Prisma ni TipTap runtime; emite un shape
 * estructural compatible (`TipTapNode` reutiliza el tipo de
 * `context-to-tiptap.ts`). Los parsers (`toRichText`, `contextTextToTipTap`)
 * lo llaman para detectar fórmulas al construir el doc que se persiste.
 *
 * Algoritmo en dos pasadas:
 *   1) Extraer `$$...$$` PRIMERO a nivel global (porque un `$` suelto dentro
 *      de un bloque no debe interpretarse como inicio de inline). Cada
 *      bloque va al array resultado como `blockMath` top-level; el texto
 *      entre bloques se acumula.
 *   2) Sobre el texto entre bloques, extraer `$...$` línea a línea y
 *      emitir `text` + `inlineMath` dentro de un `paragraph` continuo.
 *
 * Trade-offs (idénticos a los de `applyKatex` en `render.ts`, deliberadamente
 * alineados):
 *   - El regex exige no-greedy `+?` y prohíbe `$/&lt;/&gt;` dentro del
 *     delimitador para no cruzar etiquetas HTML cuando se serializa. Una
 *     fórmula con `<` o `>` no se detecta (queda como texto literal) — mismo
 *     comportamiento que ya tenía la red legacy.
 *   - El `$` literal suelto (p. ej. `$2.99 USD$` con un `$` de más) se
 *     ignora. La regex es no-greedy y exige pareja balanceada.
 *   - Texto vacío → `[]` (los callers pueden agregar un paragraph vacío
 *     si necesitan un TipTap doc mínimo).
 *   - Texto que es SOLO `$$...$$` → `[blockMath]` (sin paragraph accesorio;
 *     un blockMath top-level ya es contenido válido para un doc TipTap).
 */

export type TipTapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  /** Presente solo en nodos hoja `type: "text"`. */
  text?: string;
};

/**
 * Matchea un bloque LaTeX `$$...$$`. No-greedy, no permite `$`/`&lt;`/`&gt;`
 * dentro del delimitador (igual que `applyKatex`). Coincide con el patrón
 * usado en `render.ts:23`.
 */
const BLOCK_MATH_RE = /\$\$([^$<>]+?)\$\$/g;

/**
 * Matchea un inline LaTeX `$...$`. No-greedy, no permite `$`/`&lt;`/`&gt;`
 * ni saltos de línea (las fórmulas inline no cruzan párrafos).
 */
const INLINE_MATH_RE = /\$([^$<>\n]+?)\$/g;

/** Token interno tras la primera pasada (separación `$$...$$` del texto). */
type BlockToken = { kind: "text"; text: string } | { kind: "blockMath"; tex: string };

/** Token interno tras la segunda pasada (separación `$...$` dentro de un text). */
type InlineToken = { kind: "text"; text: string } | { kind: "inlineMath"; tex: string };

function splitOnBlockMath(text: string): BlockToken[] {
  const tokens: BlockToken[] = [];
  let cursor = 0;
  BLOCK_MATH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLOCK_MATH_RE.exec(text)) !== null) {
    if (m.index > cursor) {
      tokens.push({ kind: "text", text: text.slice(cursor, m.index) });
    }
    tokens.push({ kind: "blockMath", tex: m[1] ?? "" });
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) {
    tokens.push({ kind: "text", text: text.slice(cursor) });
  }
  return tokens;
}

function splitOnInlineMath(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  // Sin matcheos: fast-path que devuelve el texto entero.
  INLINE_MATH_RE.lastIndex = 0;
  if (!INLINE_MATH_RE.test(text)) {
    if (text.length > 0) tokens.push({ kind: "text", text });
    return tokens;
  }
  // El `test()` anterior consumió el `lastIndex`; resetear antes del split.
  INLINE_MATH_RE.lastIndex = 0;
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_MATH_RE.exec(text)) !== null) {
    if (m.index > cursor) {
      tokens.push({ kind: "text", text: text.slice(cursor, m.index) });
    }
    tokens.push({ kind: "inlineMath", tex: m[1] ?? "" });
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) {
    tokens.push({ kind: "text", text: text.slice(cursor) });
  }
  return tokens;
}

/**
 * API pública: convierte el texto de una pregunta o de un fragmento de
 * contexto en nodos TipTap. Devuelve un `[]` cuando el texto no trae
 * nada (los callers suelen prefijar con un paragraph vacío si necesitan
 * un doc no-vacío).
 *
 * La función es SIMÉTRICA al comportamiento esperado por `contextTextToTipTap`
 * y por `toRichText`: un texto sin fórmulas produce un único `paragraph`
 * con todo el texto; un texto con una sola fórmula inline es un `paragraph`
 * con `text` + `inlineMath` + `text`; un texto que arranca/termina con
 * `$$...$$` emite `blockMath` como primer/último nodo top-level.
 */
export function latexTextToTipTapNodes(text: string): TipTapNode[] {
  if (text.trim().length === 0) return [];

  const blockTokens = splitOnBlockMath(text);

  // Fast-path: nada de `$$...$$` y `text` solo → un paragraph con el texto
  // partido por inline math (puede seguir inline aunque no haya blocks).
  if (blockTokens.length === 1 && blockTokens[0]?.kind === "text") {
    const paragraph = paragraphFromText(blockTokens[0].text);
    return paragraph ? [paragraph] : [];
  }

  const out: TipTapNode[] = [];
  let pendingParaContent: TipTapNode[] = [];

  const flushParagraph = () => {
    if (pendingParaContent.length > 0) {
      out.push({ type: "paragraph", content: pendingParaContent });
      pendingParaContent = [];
    }
  };

  for (const tok of blockTokens) {
    if (tok.kind === "blockMath") {
      // Cualquier paragraph acumulado ANTES del block se emite primero.
      flushParagraph();
      out.push({ type: "blockMath", attrs: { tex: tok.tex } });
      continue;
    }
    // tok.kind === "text" — splitear por inline math y mergear al paragraph.
    const inlineTokens = splitOnInlineMath(tok.text);
    for (const it of inlineTokens) {
      if (it.kind === "inlineMath") {
        pendingParaContent.push({ type: "inlineMath", attrs: { tex: it.tex } });
      } else if (it.text.length > 0) {
        pendingParaContent.push({ type: "text", text: it.text });
      }
    }
  }
  flushParagraph();

  return out;
}

/**
 * Construye un `paragraph` a partir de un fragmento de texto donde solo
 * puede haber inline math (`$...$`). Devuelve `null` si el texto queda vacío
 * (lo que sucede p. ej. con un texto que era solo whitespace).
 */
function paragraphFromText(text: string): TipTapNode | null {
  const inlineTokens = splitOnInlineMath(text);
  if (inlineTokens.length === 0) return null;
  const content: TipTapNode[] = [];
  for (const it of inlineTokens) {
    if (it.kind === "inlineMath") {
      content.push({ type: "inlineMath", attrs: { tex: it.tex } });
    } else if (it.text.length > 0) {
      content.push({ type: "text", text: it.text });
    }
  }
  if (content.length === 0) return null;
  return { type: "paragraph", content };
}
