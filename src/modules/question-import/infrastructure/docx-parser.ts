import { ANSWER_KEYS_ORDER, type AnswerKey } from "@/modules/evaluations/domain/evaluation";
import type { ParseResult, ParsedQuestion, ParsedQuestionImage } from "../domain/parsed-question";
import { normalizeOptionKeys } from "../domain/parsed-question";

/**
 * Sube una imagen (en base64) y devuelve la URL pública. La inyección se hace
 * explícita para que (a) el parser no toque almacenamiento directamente y (b)
 * los tests puedan pasar un fake sin disco ni sharp.
 */
export type UploadImageFn = (params: {
  institutionId: string;
  contentType: string;
  base64: string;
}) => Promise<{ url: string } | { error: string }>;

export interface ParseQuestionsHtmlInput {
  html: string;
  institutionId: string;
  uploadImage: UploadImageFn;
}

/**
 * Punto de entrada puro: dada la salida de `mammoth.convertToHtml`, devuelve
 * el `ParseResult`. Sin mammoth a la vista, lo que lo hace totalmente
 * testeable sin mocks.
 */
export function parseQuestionsFromHtml({
  html,
  institutionId,
  uploadImage,
}: ParseQuestionsHtmlInput): Promise<ParseResult> {
  const { keyByNumber, globalWarnings } = parseKeyTable(html);
  const blocks = splitBlocks(html);
  return buildQuestionsFromBlocks({
    blocks,
    institutionId,
    uploadImage,
    keyByNumber,
  }).then((questions) => ({ questions, warnings: globalWarnings }));
}

// ---------- tipos internos ----------

/**
 * Un "bloque" es cada `<p>` categorizado por su texto plano. La detección es
 * por regex sobre el texto SIN etiquetas, no sobre el HTML, porque mammoth
 * mete `<strong>`, `<img>`, `<em>` en mitad del párrafo.
 */
export type Block =
  | { kind: "empty" }
  | { kind: "context"; text: string }
  | { kind: "question"; number: number; text: string; rawHtml: string; hasInlineImage: boolean }
  | { kind: "option"; letter: AnswerKey; text: string };

/** Regex: `1. `, `1) `, con espacios opcionales tras el número. */
const QUESTION_RE = /^\s*(\d{1,3})\s*[.)]\s+(.*)$/s;
/** Regex: `A. `, `A) `, `A, `, `A; `, `A: `. */
const OPTION_RE = /^\s*([A-Ha-h])\s*[\].,;:]\s+(.*)$/s;

function stripTags(html: string): string {
  // `<br>` cuenta como espacio para que "línea<br>2" se lea como "línea 2".
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

/**
 * Divide el HTML en bloques. Para localizar la tabla de clave se busca la
 * primera `<table>` cuya cabecera contenga "Clave"; esa tabla se quita del
 * HTML antes de trocear, así no se confunde con texto de preguntas.
 */
export function splitBlocks(fullHtml: string): Block[] {
  const html = cutKeyTableOut(fullHtml);
  const blocks: Block[] = [];
  const paragraphs = html.split(/<\/p>/i);
  for (const raw of paragraphs) {
    const open = raw.match(/<p[^>]*>/i);
    if (!open) continue;
    const inner = raw.slice(open.index! + open[0].length);
    const text = stripTags(inner);
    if (!text) {
      blocks.push({ kind: "empty" });
      continue;
    }
    const optMatch = text.match(OPTION_RE);
    if (optMatch) {
      const letterRaw = optMatch[1]!.toUpperCase();
      if (ANSWER_KEYS_ORDER.includes(letterRaw as AnswerKey)) {
        blocks.push({
          kind: "option",
          letter: letterRaw as AnswerKey,
          text: optMatch[2]!.trim(),
        });
        continue;
      }
    }
    const qMatch = text.match(QUESTION_RE);
    if (qMatch) {
      const n = Number(qMatch[1]);
      if (n >= 1 && n <= 999) {
        blocks.push({
          kind: "question",
          number: n,
          text: qMatch[2]!.trim(),
          rawHtml: inner,
          hasInlineImage: /<img\b/i.test(inner),
        });
        continue;
      }
    }
    blocks.push({ kind: "context", text });
  }
  return blocks;
}

/** Recorta la(s) tabla(s) de clave (cabecera contiene "Clave"). */
export function cutKeyTableOut(html: string): string {
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)];
  for (const t of tables) {
    const header = stripTags(t[0].slice(0, 200));
    if (/clave/i.test(header)) {
      return html.slice(0, t.index!) + html.slice(t.index! + t[0].length);
    }
  }
  return html;
}

// ---------- tabla de clave ----------

export type KeyRow = {
  number: number;
  answer: AnswerKey;
  competency: string | null;
  evidence: string | null;
};

/**
 * Busca la primera tabla cuya cabecera contenga "Clave" y devuelve las filas
 * estructuradas. Solo toma filas con 4 o más celdas; la columna "Asignatura"
 * se ignora porque la importación apunta a una evaluación concreta.
 */
export function parseKeyTable(html: string): {
  keyByNumber: Map<number, KeyRow>;
  globalWarnings: string[];
} {
  const keyByNumber = new Map<number, KeyRow>();
  const warnings: string[] = [];

  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)];
  let keyTable: RegExpExecArray | null = null;
  for (const t of tables) {
    const header = stripTags(t[0].slice(0, 200));
    if (/clave/i.test(header)) {
      keyTable = t;
      break;
    }
  }
  if (!keyTable) {
    warnings.push(
      "No se encontró la tabla de clave. Marca la respuesta correcta manualmente en la revisión.",
    );
    return { keyByNumber, globalWarnings: warnings };
  }

  const rows = [...keyTable[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)];
  if (rows.length < 2) {
    warnings.push("Se encontró la tabla de clave pero no tiene filas de datos.");
    return { keyByNumber, globalWarnings: warnings };
  }
  // Encontrar columnas por nombre para tolerar layouts con/sin "Asignatura"
  // o con el orden cambiado entre instituciones.
  const headerCells = [...rows[0]![0].matchAll(/<td[\s\S]*?<\/td>/gi)].map((c) =>
    stripTags(c[0]).toLowerCase(),
  );
  const findCol = (...names: string[]): number => {
    for (let i = 0; i < headerCells.length; i++) {
      if (names.some((n) => headerCells[i]?.includes(n))) return i;
    }
    return -1;
  };
  const colItem = 0;
  const colClave = 1;
  const colCompetency = findCol("competencia");
  const colEvidence = findCol("evidencia");

  for (let i = 1; i < rows.length; i++) {
    const cells = [...rows[i]![0].matchAll(/<td[\s\S]*?<\/td>/gi)].map((c) => stripTags(c[0]));
    if (cells.length < 3) continue;
    const num = Number(cells[colItem]);
    const letter = (cells[colClave] ?? "").toUpperCase().trim();
    if (!Number.isFinite(num) || num < 1 || !ANSWER_KEYS_ORDER.includes(letter as AnswerKey)) {
      continue;
    }
    keyByNumber.set(num, {
      number: num,
      answer: letter as AnswerKey,
      competency: colCompetency >= 0 ? cells[colCompetency]?.trim() || null : null,
      evidence: colEvidence >= 0 ? cells[colEvidence]?.trim() || null : null,
    });
  }

  if (keyByNumber.size === 0) {
    warnings.push(
      "Se encontró la tabla de clave pero ninguna fila tiene el formato esperado (Item | Clave | …).",
    );
  }
  return { keyByNumber, globalWarnings: warnings };
}

// ---------- armado de preguntas ----------

type Current = {
  sourceNumber: number;
  text: string;
  rawHtml: string;
  hasInlineImage: boolean;
  options: { key: AnswerKey; text: string }[];
  contextText: string | null;
  competency: string | null;
  evidence: string | null;
};

async function buildQuestionsFromBlocks(params: {
  blocks: Block[];
  institutionId: string;
  uploadImage: UploadImageFn;
  keyByNumber: Map<number, KeyRow>;
}): Promise<ParsedQuestion[]> {
  const { blocks, institutionId, uploadImage, keyByNumber } = params;
  const questions: ParsedQuestion[] = [];

  let current: Current | null = null;
  let contextAccum: string[] = [];

  const flushContext = () => {
    const ctx = contextAccum.join("\n").trim();
    if (current && ctx) current.contextText = ctx;
    contextAccum = [];
  };

  const finalize = async () => {
    if (!current) return;
    flushContext();
    if (!current.sourceNumber) return;
    const opts = current.options ?? [];
    if (opts.length < 2) {
      current = null;
      return;
    }
    const rawText = (current.text ?? "").trim();
    const finalText = stripImagesFromText(rawText);
    // hasInlineImage mira el HTML crudo; el texto ya strippeado pierde <img>.
    const image = await maybeExtractImage(current.rawHtml, institutionId, uploadImage);
    const fromKey = keyByNumber.get(current.sourceNumber);
    const q: ParsedQuestion = {
      sourceNumber: current.sourceNumber,
      text: finalText || rawText,
      options: opts,
      correctAnswer: fromKey?.answer ?? null,
      competency: current.competency ?? fromKey?.competency ?? null,
      evidence: current.evidence ?? fromKey?.evidence ?? null,
      contextTitle: null,
      contextText: current.contextText ?? null,
      image,
      warnings: image === null && current.hasInlineImage ? ["No se pudo extraer la imagen."] : [],
    };
    questions.push(normalizeOptionKeys(q));
    current = null;
  };

  for (const b of blocks) {
    if (b.kind === "question") {
      await finalize();
      current = {
        sourceNumber: b.number,
        text: b.text,
        rawHtml: b.rawHtml,
        hasInlineImage: b.hasInlineImage,
        options: [],
        contextText: null,
        competency: null,
        evidence: null,
      };
      continue;
    }
    if (b.kind === "option") {
      if (!current) continue;
      current.options.push({ key: b.letter, text: b.text });
      continue;
    }
    if (b.kind === "context") {
      // Se acumula SIEMPRE: los párrafos previos a la primera pregunta se
      // asignan a esa primera pregunta al hacer flushContext; los que llegan
      // entre preguntas se asignan a la siguiente cuando llegue.
      contextAccum.push(b.text);
      continue;
    }
    // empty → ignora
  }
  await finalize();
  flushContext();
  const last = questions[questions.length - 1];
  if (last && contextAccum.length > 0) {
    const extra = contextAccum.join("\n").trim();
    if (extra && !last.contextText) last.contextText = extra;
  }
  return questions;
}

/**
 * Si el enunciado traía imágenes inline, extrae la primera `data:` que
 * encuentre, la sube y devuelve la URL. Devuelve null si no hay imagen o si
 * la subida falla.
 */
async function maybeExtractImage(
  rawHtml: string,
  institutionId: string,
  uploadImage: UploadImageFn,
): Promise<ParsedQuestionImage | null> {
  const m = rawHtml.match(/<img\b[^>]*src="data:image\/([a-z0-9+.-]+);base64,([^"]+)"[^>]*>/i);
  if (!m) return null;
  const contentType = `image/${m[1]!.toLowerCase()}`;
  const base64 = m[2]!;
  const result = await uploadImage({ institutionId, contentType, base64 });
  if ("error" in result) return null;
  return { url: result.url };
}

function stripImagesFromText(text: string): string {
  return text.replace(/<img\b[^>]*>/gi, "").trim();
}
