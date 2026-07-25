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
 * se ignora porque la importación apunta a una formulación concreta.
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

/**
 * Política de contexto compartido:
 *
 * 1. Cada vez que arranca una pregunta nueva volcamos el accumulator al
 *    `current.contextText` (`assignContext`). Esto refleja la realidad
 *    docente: un párrafo "Lee el texto y responde 1 y 2" precede a las
 *    preguntas 1 y 2, ambas lo comparten.
 *
 * 2. `finalize()` ya NO vuelca el accumulator: si lo hiciera, los párrafos
 *    que aparecen ENTRE las opciones de una pregunta y la siguiente
 *    (introducciones de "siguiente pasaje") se le atribuirían a la pregunta
 *    anterior — error que tenía la versión anterior.
 *
 * 3. Al final, un barrido `propagateSharedContext` copia el `contextText`
 *    de una pregunta a las CONSECUTIVAS que quedan con `null`, hasta que
 *    aparezca una con contexto propio. Una pregunta "P1 → Q1, P2 → Q3"
 *    deja Q2 con el mismo P1 (porque P2 vino después de Q2), mientras que
 *    "P1 → Q1, Q2, P2 → Q3" deja Q1, Q2 con P1 y Q3 con P2.
 */
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

  const assignContext = () => {
    const ctx = contextAccum.join("\n").trim();
    if (current && ctx && !current.contextText) current.contextText = ctx;
    contextAccum = [];
  };

  const finalize = async () => {
    if (!current) return;
    // Importante: NO llamamos `assignContext` aquí. Si lo hiciéramos, los
    // párrafos acumulados entre las opciones de `current` y la SIGUIENTE
    // pregunta terminarían en la pregunta equivocada (la anterior).
    if (!current.sourceNumber) return;
    const opts = current.options ?? [];
    if (opts.length < 2) {
      // Pregunta inválida: la descartamos pero dejamos el accumulator intacto
      // para que la próxima pregunta válida herede cualquier contexto que la
      // acompañaba.
      current = null;
      return;
    }
    const rawText = (current.text ?? "").trim();
    const imageStripped = stripImagesFromText(rawText);
    const placeholderSanitized = sanitizeImagePlaceholders(imageStripped);
    // Si quedó algo tras limpiar placeholders, lo usamos; si quedó vacío,
    // caemos al texto original (sin img ni placeholders) para no perder
    // información importante del enunciado.
    const finalText = placeholderSanitized.text || imageStripped;
    const contextSanitized = current.contextText
      ? sanitizeImagePlaceholders(current.contextText)
      : { text: null, removedImagePlaceholder: false };
    // hasInlineImage mira el HTML crudo; el texto ya strippeado pierde <img>.
    const image = await maybeExtractImage(current.rawHtml, institutionId, uploadImage);
    const fromKey = keyByNumber.get(current.sourceNumber);
    const warnings: string[] = [];
    if (image === null && current.hasInlineImage) {
      warnings.push("No se pudo extraer la imagen.");
    }
    if (placeholderSanitized.removedImagePlaceholder) {
      warnings.push(
        "Esta pregunta tenía referencias a imágenes (!!IMAGEN N!!) que no se pudieron extraer; revisa el PDF original.",
      );
    }
    const sanitizedOptions = opts.map((o) => {
      const s = sanitizeImagePlaceholders(o.text);
      return { key: o.key, text: s.text || o.text.trim() };
    });
    const q: ParsedQuestion = {
      sourceNumber: current.sourceNumber,
      text: finalText,
      options: sanitizedOptions,
      correctAnswer: fromKey?.answer ?? null,
      competency: current.competency ?? fromKey?.competency ?? null,
      evidence: current.evidence ?? fromKey?.evidence ?? null,
      contextTitle: null,
      contextText: contextSanitized.text ?? null,
      image,
      warnings,
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
      assignContext(); // El accumulator precede a esta pregunta → va con ella.
      continue;
    }
    if (b.kind === "option") {
      if (!current) continue;
      current.options.push({ key: b.letter, text: b.text });
      continue;
    }
    if (b.kind === "context") {
      contextAccum.push(b.text);
      continue;
    }
    // empty → ignora
  }
  await finalize();

  // Párrafos que aparecen DESPUÉS de la última pregunta: van con esa pregunta.
  // Ya hicimos `assignContext` cuando cada pregunta arrancó, así que este
  // bloque solo recoge párrafos sueltos posteriores.
  if (contextAccum.length > 0) {
    const extra = contextAccum.join("\n").trim();
    const last = questions[questions.length - 1];
    if (extra && last && !last.contextText) last.contextText = extra;
  }

  // Propagación: una pregunta con contexto compartido transmite ese contexto
  // a las consecutivas que quedaron con `null`, hasta que aparezca un bloque
  // de contexto explícitamente distinto.
  let lastContext: string | null = null;
  for (const q of questions) {
    if (q.contextText !== null) {
      lastContext = q.contextText;
    } else if (lastContext !== null) {
      q.contextText = lastContext;
    }
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

/**
 * Placeholders literales que insertan algunas herramientas (en especial
 * `pdf2docx` cuando `soffice` no está en PATH o la imagen es vectorial) cuando
 * NO pueden extraer una figura. Tipos:
 *
 *   !!IMAGEN 3!!   !!IMAGE 3!!   !!IMG 3!!   !!FIGURA 3!!   !!FIGURE 3!!
 *
 * Si llegan al texto, algo en la UI los renderiza como `<img src=…>` o como
 * `<a href=…>` y se generan 404 contra rutas de formulación. Los saneamos
 * aquí, ANTES de que `q.text` llegue a la BD, y dejamos un warning para que
 * el docente los marque con la imagen real desde el editor visual.
 *
 * El regex acepta mayúsculas/minúsculas y separadores varios entre palabra
 * y número (espacios opcionales y pequeños signos). Devuelve un objeto con
 * el texto limpio y un flag para activar el warning.
 */
const IMAGE_PLACEHOLDER_RE = /!!\s*(?:imagen|image|img|figura|figure|fig)\s*\d+\s*!!/gi;

export interface SanitizedText {
  text: string;
  /** true si se eliminó al menos un placeholder de imagen del texto. */
  removedImagePlaceholder: boolean;
}

export function sanitizeImagePlaceholders(text: string): SanitizedText {
  if (!text) return { text: "", removedImagePlaceholder: false };
  const matches = text.match(IMAGE_PLACEHOLDER_RE);
  const cleaned = text
    .replace(IMAGE_PLACEHOLDER_RE, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return {
    text: cleaned,
    removedImagePlaceholder: matches !== null && matches.length > 0,
  };
}
