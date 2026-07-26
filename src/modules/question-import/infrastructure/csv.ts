import { ANSWER_KEYS_ORDER, type AnswerKey } from "@/modules/evaluations/domain/evaluation";
import type { ParsedQuestion, ParseResult } from "../domain/parsed-question";
import { normalizeOptionKeys } from "../domain/parsed-question";

/**
 * Parser CSV nativo (sin dependencias) para la importación masiva de
 * preguntas. Calcado del de estudiantes:
 * - autodetecta `,` o `;` por la línea de encabezado (Excel es-CO usa `;`),
 * - comillas dobles con escape `""`,
 * - normalización de encabezados sin tildes y `HEADER_ALIASES` con sinónimos
 *   en español.
 *
 * Columnas aceptadas (mínimo `enunciado` + `correcta` + 2 opciones):
 *   enunciado | a | b | c | d | e | f | g | h | correcta
 *   competencia | evidencia | contexto
 *
 * Las opciones que NO traigan texto se ignoran; si la correcta está entre
 * las que se quitaron, queda `null` y la revisión obliga a marcarla.
 */

function detectDelimiter(headerLine: string): "," | ";" {
  return headerLine.split(";").length > headerLine.split(",").length ? ";" : ",";
}

function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

/** Minúsculas, sin tildes, sin separadores. */
function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s._-]/g, "");
}

type CanonicalKey =
  | "text"
  | "competency"
  | "evidence"
  | "context"
  | "correctAnswer"
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H";

const HEADER_ALIASES: Record<string, CanonicalKey> = {
  enunciado: "text",
  pregunta: "text",
  texto: "text",
  pregunta_: "text",
  item: "text",
  correcta: "correctAnswer",
  respuesta: "correctAnswer",
  respuestacorrecta: "correctAnswer",
  clave: "correctAnswer",
  respuesta_correcta: "correctAnswer",
  competencia: "competency",
  evidencia: "evidence",
  evidenciadeaprendizaje: "evidence",
  contexto: "context",
  lectura: "context",
};

const REQUIRED: CanonicalKey[] = ["text", "correctAnswer"];

export interface ParsedQuestionsCsv {
  result: ParseResult;
  /** Columnas canónicas mínimas ausentes en el encabezado. */
  missing: CanonicalKey[];
}

const OPTION_KEYS: CanonicalKey[] = ["A", "B", "C", "D", "E", "F", "G", "H"];

function canonicalFor(header: string): CanonicalKey | null {
  const key = normalizeHeader(header);
  if (HEADER_ALIASES[key]) return HEADER_ALIASES[key]!;
  // Acepta "a", "opciona", "opcion_a", etc.
  const letter = ANSWER_KEYS_ORDER.find((k) => k.toLowerCase() === key);
  if (letter) return letter as CanonicalKey;
  if (key.startsWith("opcion")) {
    const letter = ANSWER_KEYS_ORDER.find((k) => key.endsWith(k.toLowerCase()));
    if (letter) return letter as CanonicalKey;
  }
  return null;
}

export function parseQuestionsCsv(text: string): ParsedQuestionsCsv {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) return { result: { questions: [], warnings: [] }, missing: REQUIRED };

  const delimiter = detectDelimiter(lines[0]!);
  const headerCells = splitLine(lines[0]!, delimiter);
  const headers = headerCells.map((h) => canonicalFor(h));
  const missing = REQUIRED.filter((r) => !headers.includes(r));
  if (missing.length > 0) return { result: { questions: [], warnings: [] }, missing };

  const warnings: string[] = [];

  const questions: ParsedQuestion[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]!, delimiter);
    const record: Partial<Record<CanonicalKey, string>> = {};
    headers.forEach((key, idx) => {
      if (key) record[key] = cells[idx] ?? "";
    });

    const text = (record.text ?? "").trim();
    if (!text) continue; // fila vacía o sin enunciado → se ignora en silencio

    // Lee opciones en orden A..H; las vacías no entran.
    const options: { key: AnswerKey; text: string }[] = [];
    for (const k of OPTION_KEYS) {
      const cell = (record[k] ?? "").trim();
      if (cell) options.push({ key: k as AnswerKey, text: cell });
    }
    if (options.length < 2) {
      warnings.push(`Fila ${i + 1}: solo se leyeron ${options.length} opción(es); se descartó.`);
      continue;
    }

    const rawCorrect = (record.correctAnswer ?? "").trim().toUpperCase();
    const correctLetter = ANSWER_KEYS_ORDER.find((k) => k === rawCorrect);
    if (rawCorrect && !correctLetter) {
      warnings.push(`Fila ${i + 1}: la columna "correcta" no es A–H ("${rawCorrect}").`);
    }

    questions.push(
      normalizeOptionKeys({
        sourceNumber: i,
        text,
        options,
        correctAnswer: correctLetter ?? null,
        competency: record.competency?.trim() || null,
        evidence: record.evidence?.trim() || null,
        contextTitle: null,
        contextText: record.context?.trim() || null,
        // CSV no tiene canal para imágenes de contexto; el docente las
        // añade en el editor visual después del alta.
        contextImages: {},
        image: null,
        warnings: [],
      }),
    );
  }

  return { result: { questions, warnings }, missing: [] };
}

/**
 * Plantilla del CSV que el docente se descarga. Las columnas están en el
 * orden recomendado y los sinónimos ya conocidos para que no falle si las
 * renombra ("Pregunta", "Respuesta correcta"…).
 */
export const QUESTIONS_CSV_TEMPLATE = [
  "enunciado,a,b,c,d,correcta,competencia,evidencia,contexto",
  '"¿Cuál es la capital de Colombia?","Bogotá","Medellín","Cali","Barranquilla",A,"Comunicación","Lee textos informativos",""',
  '"¿2+2?","3","4","5","6",B,"Numérica","Resuelve sumas básicas",""',
].join("\n");
