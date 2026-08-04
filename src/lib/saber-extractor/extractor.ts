import type { AiClient } from "./provider";
import { extractionTool, pdfBlock } from "./provider";
import { EXTRACTION_SYSTEM, FIGURES_SYSTEM } from "./prompts";
import { ExtractionChunkSchema, type ExtractionChunk } from "./types";
import type { PdfChunk } from "./pdf";

export interface ExtractOptions {
  model: string;
  maxTokens?: number;
  /** Pedir también la ubicación (bbox) de cada figura, para recortarla. */
  withFigures?: boolean;
}

export async function extractChunk(
  client: AiClient,
  chunk: PdfChunk,
  { model, maxTokens = 16000, withFigures = false }: ExtractOptions,
): Promise<ExtractionChunk> {
  const tool = extractionTool(withFigures);
  const userText =
    `Extrae TODAS las preguntas y contextos de estas páginas ` +
    `(${chunk.pages.join(", ")}). Recuerda numerar imágenes de forma global ` +
    `([IMAGEN N]) y llamar la herramienta emit_extraction.` +
    (withFigures
      ? ` Incluye el bbox de cada figura en \`figures\`, con \`page\` relativa ` +
        `a este fragmento (1..${chunk.pages.length}).`
      : "");

  const msg = await client.createMessage({
    model,
    max_tokens: maxTokens,
    system: [
      {
        type: "text",
        text: withFigures ? EXTRACTION_SYSTEM + FIGURES_SYSTEM : EXTRACTION_SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name },
    messages: [
      {
        role: "user",
        content: [pdfBlock(chunk.base64), { type: "text", text: userText }],
      },
    ],
  });

  const raw = msg.firstToolInput(tool.name);
  if (raw == null) {
    throw new Error(
      `El modelo no llamó emit_extraction en el chunk ${chunk.index} (páginas ${chunk.pages.join(", ")}).`,
    );
  }

  const parsed = ExtractionChunkSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  // Rescate elemento a elemento: un ítem malformado no debe tumbar el chunk.
  const obj = raw as { contexts?: unknown; questions?: unknown; figures?: unknown };
  const salvage = <T>(
    value: unknown,
    schema: { safeParse(v: unknown): { success: boolean; data?: T } },
  ): T[] =>
    (Array.isArray(value) ? value : [])
      .map((item) => schema.safeParse(item))
      .filter((r): r is { success: true; data: T } => r.success)
      .map((r) => r.data);

  return ExtractionChunkSchema.parse({
    contexts: salvage(obj.contexts, ExtractionChunkSchema.shape.contexts.element),
    questions: salvage(obj.questions, ExtractionChunkSchema.shape.questions.element),
    figures: salvage(obj.figures, ExtractionChunkSchema.shape.figures.removeDefault().element),
  });
}
