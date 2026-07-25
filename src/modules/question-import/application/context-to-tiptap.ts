/**
 * Convierte un `contextText` (string que puede contener bloques
 * `[TABLA: ...]`) en un array de nodos TipTap de bloque.
 *
 *   - Texto entre bloques  → 1+ `paragraph` (split por líneas no vacías)
 *   - Bloque `[TABLA: ...]` → 1 `heading` level-4 con el título (si
 *     no está vacío) + 1 `table/tableRow/tableHeader/tableCell`
 *   - Placeholders `[IMAGEN N]` se preservan como texto del paragraph
 *     (la asociación a `Figure` recortada es otra capa; ver plan).
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
 * Convierte un `contextText` en nodos TipTap de bloque (paragraphs +
 * headings + tables). Trim del input.
 *
 * Casos:
 *   - Input vacío → `[]`.
 *   - Solo texto plano → `[paragraph("...")]` (idéntico al comportamiento
 *     previo; no rompe a los callers que esperan este shape).
 *   - Texto + tablas intercaladas → orden preservado.
 *   - Bloque con typo (ej. `[ABLA: T]`) → no se reconoce, queda como
 *     texto literal del paragraph; nunca perdemos contenido.
 */
export function contextTextToTipTap(text: string): TipTapNode[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  const blocks: TipTapNode[] = [];
  const blockRe = /\[TABLA:([\s\S]*?)\]/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(trimmed)) !== null) {
    // Texto entre el cursor y el inicio del bloque → paragraphs.
    const between = trimmed.slice(cursor, match.index);
    pushTextBlocks(blocks, between);

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
  pushTextBlocks(blocks, tail);

  return blocks;
}

// ---------- helpers internos ----------

/** Convierte un fragmento de texto (sin bloques `[TABLA:...]`) en
 *  paragraphs. Vacío → no emite nada. */
function pushTextBlocks(out: TipTapNode[], text: string): void {
  const trimmed = text.trim();
  if (trimmed.length === 0) return;
  // Cada línea no vacía es un paragraph. No usamos `\n{2,}` para
  // párrafos múltiples: el contexto del LLM típicamente llega con
  // saltos simples, y partir por cada línea da un espaciado más
  // predecible al renderizar.
  for (const line of trimmed.split("\n")) {
    const lineTrimmed = line.trim();
    if (lineTrimmed.length === 0) continue;
    out.push({
      type: "paragraph",
      content: [{ type: "text", text: lineTrimmed }],
    });
  }
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

/** "A | B | C" → ["A","B","C"]; "| A | B |" → ["A","B"]; "  A  " → ["A"]. */
function parseLine(line: string): RawLine {
  // Split por `|`, trim, descarta vacíos. Esto ignora intencionalmente
  // celdas vacías intermedias (el LLM no las emite y manejar `\|` no
  // está en la spec). Si en el futuro se quiere soportar celdas vacías,
  // cambiar a `line.split("|").map(s => s.trim())` y aceptar "" como
  // celda válida.
  const cells = line
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return { cells };
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

/** Construye un nodo TipTap `table` con headers + data rows. */
function buildTableNode(headers: string[], rows: string[][]): TipTapNode {
  const headerRow: TipTapNode | null =
    headers.length > 0
      ? {
          type: "tableRow",
          content: headers.map((h) => ({
            type: "tableHeader",
            content: [{ type: "paragraph", content: [{ type: "text", text: h }] }],
          })),
        }
      : null;

  const dataRows: TipTapNode[] = rows.map((r) => ({
    type: "tableRow",
    content: r.map((c) => ({
      type: "tableCell",
      content: [{ type: "paragraph", content: [{ type: "text", text: c }] }],
    })),
  }));

  return {
    type: "table",
    content: headerRow ? [headerRow, ...dataRows] : dataRows,
  };
}
