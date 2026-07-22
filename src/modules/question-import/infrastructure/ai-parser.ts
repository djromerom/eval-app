import { ANSWER_KEYS_ORDER } from "@/modules/evaluations/domain/evaluation";
import type { ParsedQuestion, ParseResult } from "../domain/parsed-question";
import { normalizeOptionKeys } from "../domain/parsed-question";

interface AiQuestion {
  contextTitle?: string;
  contextText?: string;
  text: string;
  options: { key: string; text: string }[];
  correctAnswer: string;
  competency?: string;
  evidence?: string;
  imagePlaceholder?: string;
}

interface AiResponse {
  contexts: { title: string | null; text: string }[];
  questions: AiQuestion[];
}

function isValidAnswerKey(key: string): key is "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" {
  return ANSWER_KEYS_ORDER.includes(key as "A");
}

function extractJson(raw: string): string {
  // 1. Quita bloque <think>...</think> (razonamiento del modelo)
  const clean = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  // 2. Quita bloques ```json ... ``` o ``` ... ```
  const fence = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1]!.trim();
  // 3. Busca el primer { y el último }
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start !== -1 && end > start) return clean.slice(start, end + 1);
  return clean;
}

export function parseQuestionsWithAi(documentText: string, aiJson: string): ParseResult {
  const warnings: string[] = [];

  let parsed: AiResponse;
  try {
    const clean = extractJson(aiJson);
    parsed = JSON.parse(clean) as AiResponse;
  } catch {
    return { questions: [], warnings: ["La respuesta de la IA no es JSON válido."] };
  }

  if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
    return { questions: [], warnings: ["La IA no encontró preguntas en el documento."] };
  }

  const questions: ParsedQuestion[] = [];
  const contextByText = new Map<string, { title: string | null; text: string }>();
  const contextByTitle = new Map<string, { title: string | null; text: string }>();

  for (const ctx of parsed.contexts ?? []) {
    const text = ctx.text.trim();
    if (text) {
      contextByText.set(text, ctx);
      if (ctx.title?.trim()) contextByTitle.set(ctx.title.trim(), ctx);
    }
  }

  function resolveContext(q: AiQuestion): {
    contextTitle: string | null;
    contextText: string | null;
  } {
    const text = q.contextText?.trim() || null;
    const title = q.contextTitle?.trim() || null;
    if (text) return { contextTitle: title, contextText: text };
    if (title) {
      const byTitle = contextByTitle.get(title);
      if (byTitle) return { contextTitle: title, contextText: byTitle.text };
    }
    return { contextTitle: null, contextText: null };
  }

  for (let i = 0; i < parsed.questions.length; i++) {
    const q = parsed.questions[i]!;
    const sourceNumber = i + 1;

    if (!q.text?.trim()) {
      warnings.push(`Pregunta ${sourceNumber}: sin enunciado, se descartó.`);
      continue;
    }

    const options: { key: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H"; text: string }[] = [];

    if (Array.isArray(q.options)) {
      for (const o of q.options) {
        const k = o.key?.toUpperCase();
        if (isValidAnswerKey(k) && o.text?.trim()) {
          options.push({ key: k, text: o.text.trim() });
        }
      }
    }

    if (options.length < 2) {
      warnings.push(
        `Pregunta ${sourceNumber}: solo ${options.length} opción(es) válida(s), se descartó.`,
      );
      continue;
    }

    const rawCorrect = q.correctAnswer?.toUpperCase();
    const correctLetter = isValidAnswerKey(rawCorrect) ? rawCorrect : null;
    if (!correctLetter) {
      warnings.push(
        `Pregunta ${sourceNumber}: respuesta correcta inválida ("${q.correctAnswer}"), se dejará sin marcar.`,
      );
    }

    const { contextTitle, contextText } = resolveContext(q);

    questions.push(
      normalizeOptionKeys({
        sourceNumber,
        text: q.text.trim(),
        options,
        correctAnswer: correctLetter,
        competency: q.competency?.trim() || null,
        evidence: q.evidence?.trim() || null,
        contextTitle,
        contextText,
        image: q.imagePlaceholder ? { url: q.imagePlaceholder } : null,
        warnings: [],
      }),
    );
  }

  return { questions, warnings };
}

export const AI_PROMPT_SYSTEM = `Eres un asistente experto en analizar exámenes tipo ICFES colombianos.

Tu tarea es extraer TODAS las preguntas del documento que se te entrega, identificando:

1. **Contextos compartidos** — Lecturas, textos, tablas o imágenes que agrupan varias preguntas.
2. **Preguntas** con su enunciado, opciones (A–H) y respuesta correcta.

Devuelve ÚNICAMENTE el JSON — sin bloques de código, sin markdown, sin texto adicional — siguiendo esta estructura exacta:

{
  "contexts": [
    { "title": "Título del contexto (o null si no tiene)", "text": "Texto completo del contexto" }
  ],
  "questions": [
    {
      "contextTitle": "Título del contexto al que pertenece (o null)",
      "contextText": "Texto del contexto compartido (MISMO texto exacto si comparte con otras; vacío si no aplica)",
      "text": "Enunciado completo de la pregunta",
      "options": [
        { "key": "A", "text": "Texto de la opción A" },
        { "key": "B", "text": "Texto de la opción B" }
      ],
      "correctAnswer": "A",
      "competency": "Competencia (o null si no se menciona)",
      "evidence": "Evidencia (o null)",
      "imagePlaceholder": "Si hay imagen [IMAGEN N], pon !!IMAGEN N!! (ej: !!IMAGEN 3!!, o null si no tiene)"
    }
  ]
}

REGLAS:
- Cada pregunta DEBE tener al menos 2 opciones y un enunciado.
- La respuesta correcta DEBE ser una letra A–H.
- Si varias preguntas comparten el mismo contexto: escribe el contextText COMPLETO solo UNA VEZ en el array "contexts". En las preguntas, pon SOLO contextTitle para referenciarlo (no repitas el text completo).
- Las opciones se numeran A, B, C, D, ... en orden.
- Si no hay contexto compartido, pon contextText vacío en contexts y contextTitle null en la pregunta.
- Si ves imágenes en el contexto, menciónalas con su número exacto: [IMAGEN 1], [IMAGEN 2], etc. En la pregunta, pon imagePlaceholder con el MISMO número: "!!IMAGEN 1!!", "!!IMAGEN 2!!".
- Si ves tablas en el contexto, escríbelas SIEMPRE con este formato EXACTO dentro de [TABLA:...], con el título en la primera línea, una fila separadora |---|, y CADA FILA en su PROPIA línea:

[TABLA: Título descriptivo
| Cabecera 1 | Cabecera 2 | Cabecera 3 |
|------------|------------|------------|
| Dato 1     | Dato 2     | Dato 3     |
| Dato 4     | Dato 5     | Dato 6     |]

NUNCA pongas filas pegadas en una sola línea.`;
