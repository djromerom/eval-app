/**
 * Convierte un `contextText` (string que puede contener bloques
 * `[TABLA: ...]` y placeholders `[IMAGEN id]`) en un array de nodos
 * TipTap de bloque.
 *
 *   - Texto entre bloques  → 1+ `paragraph` (split por líneas no vacías)
 *   - Bloque `[TABLA: ...]` → 1 `heading` level-4 con el título (si
 *     no está vacío) + 1 `table/tableRow/tableHeader/tableCell`
 *   - Placeholders `[IMAGEN id]` → 1 `image` node con `src` resuelto
 *     desde el `imageMap` opcional. Si el id no está en el map, el
 *     placeholder se conserva como texto literal.
 *
 * El LLM tiene una instrucción explícita en `saber-extractor/prompts.ts`
 * de escribir CADA FILA en su PROPIA línea, pero en la práctica las
 * rompe seguido (pega título + cabeceras en la primera línea). Este
 * parser tolera las dos formas y se apoya en la fila separadora
 * `|---|` (o el nº de celdas de las filas de datos) para reconstruir
 * la tabla aunque venga mal.
 *
 * Es una función PURA — no toca Prisma, no toca el DOM, no instancia
 * TipTap. Los nodos resultantes se pueden pasar directo a un TipTap
 * doc (`{ type: "doc", content: nodes }`) o serializar a HTML vía
 * `renderRichText`.
 */

// ---------- TipTap (mínimo subset) ----------

/** Nodo TipTap mínimo (sub-shape del TipTapDoc completo). Exportado
 *  para que los tests y los consumidores de este módulo puedan anotar
 *  sin re-declarar el shape. */
export type TipTapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  /** Presente solo en nodos hoja `type: "text"`. */
  text?: string;
};

// ---------- API pública ----------

/**
 * Convierte un `contextText` (string que puede contener placeholders
 * `[IMAGEN id]` además de bloques `[TABLA: ...]`) en nodos TipTap de
 * bloque (paragraphs + headings + tables + images). Trim del input.
 *
 * Casos:
 *   - Input vacío → `[]`.
 *   - Solo texto plano → `[paragraph("...")]` (idéntico al comportamiento
 *     previo; no rompe a los callers que esperan este shape).
 *   - Texto + tablas intercaladas → orden preservado.
 *   - Bloque con typo (ej. `[ABLA: T]`) → no se reconoce, queda como
 *     texto literal del paragraph; nunca perdemos contenido.
 *   - Placeholders `[IMAGEN id]` → un nodo `image` por cada uno, con
 *     `src` resuelto desde `imageMap` (si viene). Si el id no está en
 *     el map (figura huérfana / no subida), el placeholder se conserva
 *     como texto literal para no perder la referencia.
 *
 * `imageMap` es opcional: si no se pasa, los placeholders `[IMAGEN id]`
 * se preservan como texto idéntico al comportamiento previo (no rompemos
 * a los callers que no pasen imágenes).
 */
export function contextTextToTipTap(text: string, imageMap?: Record<string, string>): TipTapNode[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  const blocks: TipTapNode[] = [];
  const blockRe = /\[TABLA:([\s\S]*?)\]/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(trimmed)) !== null) {
    // Texto entre el cursor y el inicio del bloque → paragraphs (con
    // imágenes intercaladas si las hubiera).
    const between = trimmed.slice(cursor, match.index);
    pushTextBlocks(blocks, between, imageMap);

    // El bloque en sí → heading + table.
    const body = match[1] ?? "";
    const parsed = parseTablaBlock(body);
    if (parsed.title) {
      blocks.push({
        type: "heading",
        attrs: { level: 4 },
        content: [{ type: "text", text: parsed.title }],
      });
    }
    if (parsed.headers.length > 0 || parsed.rows.length > 0) {
      blocks.push(buildTableNode(parsed.headers, parsed.rows));
    }

    cursor = match.index + match[0].length;
  }

  // Texto restante tras el último bloque.
  const tail = trimmed.slice(cursor);
  pushTextBlocks(blocks, tail, imageMap);

  return blocks;
}

// ---------- helpers internos ----------

/** Convierte un fragmento de texto (sin bloques `[TABLA:...]`) en
 *  paragraphs intercalando nodos `image` cuando aparecen placeholders
 *  `[IMAGEN id]`. Vacío → no emite nada. */
function pushTextBlocks(out: TipTapNode[], text: string, imageMap?: Record<string, string>): void {
  const trimmed = text.trim();
  if (trimmed.length === 0) return;
  // Estrategia: split el texto en segmentos alternados de TEXTO e
  // IMAGEN. Cada segmento TEXT se procesa como antes (split por `\n`,
  // un paragraph por línea); los nodos IMAGE se insertan TAL CUAL
  // entre paragraphs (no se anidan dentro de un <p> — son leaf block
  // nodes en el schema de TipTap).
  const segments = splitTextByImages(trimmed, imageMap);
  for (const seg of segments) {
    if (seg.kind === "image") {
      out.push(seg.node);
      continue;
    }
    for (const line of seg.text.split("\n")) {
      const lineTrimmed = line.trim();
      if (lineTrimmed.length === 0) continue;
      out.push({
        type: "paragraph",
        content: [{ type: "text", text: lineTrimmed }],
      });
    }
  }
}

/**
 * Un segmento del split por placeholders `[IMAGEN id]`. El tag
 * `kind: "text"` representa un fragmento de texto plano que luego
 * `pushTextBlocks` parte por líneas; `kind: "image"` representa un
 * nodo `image` TipTap listo para empujar al output.
 */
type TextSegment = { kind: "text"; text: string };
type ImageSegment = { kind: "image"; node: TipTapNode };
type Segment = TextSegment | ImageSegment;

/**
 * Split por placeholders `[IMAGEN id]` (y `[IMAGEN id: descripción]`)
 * dentro de un fragmento de texto. Captura el id y, si está en
 * `imageMap`, emite un nodo `image` con `src` resuelto. Si el
 * placeholder trae una descripción (lo que el motor emite por
 * convención de prompt — ver `lib/saber-extractor/prompts.ts`),
 * se conserva como `alt` y `title` del nodo para accesibilidad y
 * como pista visual cuando el docente esté revisando.
 *
 * Comportamiento por fast-path: si NO hay `imageMap`, o si ningún
 * placeholder matchea una entrada del `imageMap`, devuelve el texto
 * como un único `TextSegment` — preservando el comportamiento previo
 * (un solo `paragraph` con todo el texto). Esto evita romper los
 * callers que pasan contextos sin imágenes, o contextos con
 * placeholders huérfanos (e.g. figura no subida).
 *
 * Importante: el formato `[IMAGEN id]` (con corchetes) NO se confunde
 * con `!!IMAGEN id!!` (formato de la imagen de la pregunta) — el
 * regex exige `[` al inicio.
 *
 * Formato aceptado por el regex:
 *   [IMAGEN p04-fig1]                          → id solo
 *   [IMAGEN p04-fig1]                          → whitespace tolerante
 *   [IMAGEN p04-fig1: descripción]             → descripción como alt/title
 *   [IMAGEN p04-fig1:cuadro al óleo]           → sin espacio tras `:`
 *   [IMAGEN p04-fig1: "Título con comillas"]   → comillas literales se preservan
 *
 * Limitación: si la descripción contiene `]` anidados (ej.
 * `[IMAGEN p04-fig1: cuadro [óleo]]`), el corte se hace en el
 * PRIMER `]` y el resto queda como texto. Raro en la práctica: el
 * motor emite descripciones planas.
 */
const IMAGE_RE = /\[IMAGEN\s+([\w-]+)(?::\s*([^\]]*))?\s*\]/gi;

type ImageMatch = {
  start: number;
  end: number;
  url: string;
  /** Descripción textual tras `:`, o `null` si no viene. */
  description: string | null;
};

function splitTextByImages(text: string, imageMap?: Record<string, string>): Segment[] {
  // Fast-path: sin imageMap no hay nada que emitir como image.
  if (!imageMap) return [{ kind: "text", text }];

  // Pre-pasada: ¿hay AL MENOS un match con URL? Si no, devolvemos
  // texto plano (preservamos los placeholders literales).
  IMAGE_RE.lastIndex = 0;
  const matchingRanges: ImageMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = IMAGE_RE.exec(text)) !== null) {
    const id = m[1]!;
    const url = imageMap[id];
    if (url) {
      const description = m[2]?.trim() ? m[2].trim() : null;
      matchingRanges.push({
        start: m.index,
        end: m.index + m[0].length,
        url,
        description,
      });
    }
  }
  if (matchingRanges.length === 0) return [{ kind: "text", text }];

  // Split real: emitir text + image + text + image + ...
  const out: Segment[] = [];
  let cursor = 0;
  for (const r of matchingRanges) {
    if (r.start > cursor) {
      out.push({ kind: "text", text: text.slice(cursor, r.start) });
    }
    const attrs: Record<string, unknown> = {
      src: r.url,
      // `width: 80` es el default razonable para figuras de
      // contexto en un cuadernillo ICFES (deja margen a la columna
      // de opciones). Configurable desde el editor visual: la
      // `ResizableImage` persiste `attrs.width` en el node.
      width: 80,
    };
    // La descripción del motor es útil como `alt` (accesibilidad)
    // y como `title` (tooltip al pasar el mouse). TipTap Image
    // expone ambos attrs; si vienen vacíos los omitimos para no
    // guardar strings `""` que ensucien el doc JSON.
    if (r.description) {
      attrs.alt = r.description;
      attrs.title = r.description;
    }
    out.push({ kind: "image", node: { type: "image", attrs } });
    cursor = r.end;
  }
  if (cursor < text.length) {
    out.push({ kind: "text", text: text.slice(cursor) });
  }
  return out;
}

/** Una fila de la "tabla cruda" parseada. */
type RawLine = { cells: string[] };

/** Resultado del parser de un bloque `[TABLA: ...]`. */
type TablaParsed = {
  title: string;
  headers: string[];
  rows: string[][];
};

/**
 * Parsea el contenido de un bloque `[TABLA: ...]` (sin los marcadores
 * externos). Tolerante a las dos formas que emite el LLM:
 *
 *   1. Canónica (multi-línea con separador):
 *        [TABLA: Título
 *        | H1 | H2 |
 *        |----|----|
 *        | D1 | D2 |]
 *
 *   2. Malformada (todo en la primera línea, sin separador):
 *        [TABLA: Título | H1 | H2 |
 *        |----|----|
 *        | D1 | D2 |]
 *
 *   3. Muy malformada (sin separador, todo pegado):
 *        [TABLA: Título | H1 | H2 | D1 | D2 |]
 */
function parseTablaBlock(body: string): TablaParsed {
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return { title: "", headers: [], rows: [] };

  // Parsea cada línea como una lista de celdas (split por `|`,
  // trimming, descartando vacíos en los extremos). Una línea tipo
  // "| A | B |" produce ["A", "B"]; "A | B" también.
  const parsedLines: RawLine[] = lines.map(parseLine);

  // Detectar fila separadora: TODAS sus celdas matchean /^-{3,}$/
  // tras trim. La separadora se elimina del análisis.
  const sepIdx = parsedLines.findIndex(isSeparatorLine);
  let headerLines: RawLine[];
  let dataLines: RawLine[];
  if (sepIdx >= 0) {
    headerLines = parsedLines.slice(0, sepIdx);
    dataLines = parsedLines.slice(sepIdx + 1);
  } else {
    // Sin separador: tratar la primera línea como candidata a
    // (título + cabeceras pegados), el resto como datos.
    headerLines = parsedLines.length > 0 ? [parsedLines[0]!] : [];
    dataLines = parsedLines.slice(1);
  }

  // Si no hay filas de datos, no podemos deducir el nº de columnas
  // "reales" — caemos al fallback: todo headerLines es título, sin
  // headers, sin rows.
  if (dataLines.length === 0) {
    const title = headerLines
      .map((l) => l.cells.join(" | "))
      .join(" | ")
      .trim();
    return { title, headers: [], rows: [] };
  }

  // Nº de columnas inferido de la primera fila de datos.
  const dataCols = Math.max(...dataLines.map((l) => l.cells.length));
  if (dataCols === 0) {
    const title = headerLines
      .map((l) => l.cells.join(" | "))
      .join(" | ")
      .trim();
    return { title, headers: [], rows: [] };
  }

  // Resolver título + headers a partir de headerLines, sabiendo que
  // los datos tienen `dataCols` columnas.
  let title = "";
  let headers: string[] = [];
  if (headerLines.length === 0) {
    headers = Array(dataCols).fill("");
  } else {
    // Aplanar todas las celdas de headerLines en una sola secuencia;
    // los últimos `dataCols` items son los headers, el resto es
    // título. Esto cubre tanto el caso canónico (primera fila =
    // cabeceras exactas) como el malformado (primera fila = título +
    // cabeceras pegados).
    const flat: string[] = [];
    for (const l of headerLines) flat.push(...l.cells);
    if (flat.length <= dataCols) {
      title = flat.join(" | ").trim();
      headers = Array.from({ length: dataCols }, (_, i) => flat[i] ?? "");
    } else {
      const split = flat.length - dataCols;
      title = flat.slice(0, split).join(" | ").trim();
      headers = flat.slice(split);
    }
  }

  // Normalizar filas de datos al ancho `dataCols` (recortar o
  // padear con ""). El LLM a veces omite celdas al final.
  const rows = dataLines.map((l) => normalizeRow(l.cells, dataCols));

  return { title, headers, rows };
}

/** "A | B | C" → ["A","B","C"]; "| A | B |" → ["A","B"]; "  A  " → ["A"].
 *  "| A | | B |" → ["A","","B"] — celdas vacías INTERMEDIAS se preservan
 *  (el LLM las emite para filas tipo "| | B. cake |" en ejercicios matching,
 *  y para la última fila "| 5. Some people put this... | |" donde la col
 *  derecha queda vacía). Las vacías en los EXTREMOS se descartan SÓLO si
 *  la línea empieza/termina con `|` (los `|` de borde son delimitadores
 *  de fila, no celdas). */
function parseLine(line: string): RawLine {
  let trimmed = line;
  // Saca el `|` inicial/final SOLO si la línea está claramente delimitada
  // (empieza/termina con `|`). Si no, se respetan como parte del contenido.
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return {
    cells: trimmed.split("|").map((s) => s.trim()),
  };
}

/** Línea separadora: todas sus celdas son solo guiones (`---`). */
function isSeparatorLine(line: RawLine): boolean {
  if (line.cells.length === 0) return false;
  return line.cells.every((c) => /^-{3,}$/.test(c));
}

/** Recorta o paddea una fila a `width` columnas. */
function normalizeRow(cells: string[], width: number): string[] {
  if (cells.length >= width) return cells.slice(0, width);
  return [...cells, ...Array.from({ length: width - cells.length }, () => "")];
}

/** Construye un nodo TipTap `table` con headers + data rows.
 *
 * OJO: ProseMirror rechaza nodos `text` con string vacío (`Empty text nodes
 * are not allowed`). El LLM a veces emite celdas vacías (ej. `| | B. cake |`
 * para una opción sin descripción), así que cada celda produce un paragraph
 * cuyo `content` es `[{ text }]` solo si el texto NO está vacío — si está
 * vacío, el paragraph se queda sin text node (válido: paragraph admite 0
 * marks inline). */
function buildTableNode(headers: string[], rows: string[][]): TipTapNode {
  const cellText = (text: string): TipTapNode[] => {
    if (text.length === 0) return [];
    return [{ type: "text", text }];
  };
  const cellParagraph = (text: string): TipTapNode => ({
    type: "paragraph",
    content: cellText(text),
  });

  const headerRow: TipTapNode | null =
    headers.length > 0
      ? {
          type: "tableRow",
          content: headers.map((h) => ({
            type: "tableHeader",
            content: [cellParagraph(h)],
          })),
        }
      : null;

  const dataRows: TipTapNode[] = rows.map((r) => ({
    type: "tableRow",
    content: r.map((c) => ({
      type: "tableCell",
      content: [cellParagraph(c)],
    })),
  }));

  return {
    type: "table",
    content: headerRow ? [headerRow, ...dataRows] : dataRows,
  };
}
