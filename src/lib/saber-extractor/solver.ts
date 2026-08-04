import type { AiClient } from "./provider";
import { extractJson } from "./provider";
import { SOLVER_SYSTEM } from "./prompts";
import {
  SolvedAnswerSchema,
  type Context,
  type ExtractedQuestion,
  type SolvedAnswer,
} from "./types";

export interface SolveOptions {
  model: string;
  batchSize?: number;
  thinkingBudget?: number;
  maxTokens?: number;
}

function renderQuestion(q: ExtractedQuestion, contextByTitle: Map<string, Context>): string {
  const ctx = q.contextTitle ? contextByTitle.get(q.contextTitle) : undefined;
  const parts: string[] = [`### Pregunta ${q.number}`];
  if (ctx) {
    if (ctx.title) parts.push(`Contexto: ${ctx.title}`);
    parts.push(ctx.text);
  }
  if (q.imagePlaceholder) parts.push(`(Depende de figura: ${q.imagePlaceholder})`);
  parts.push(q.text);
  for (const o of q.options) parts.push(`${o.key}. ${o.text}`);
  return parts.join("\n");
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function solveAnswers(
  client: AiClient,
  questions: ExtractedQuestion[],
  contexts: Context[],
  { model, batchSize = 8, thinkingBudget = 4000, maxTokens = 8000 }: SolveOptions,
): Promise<Map<number, SolvedAnswer>> {
  const contextByTitle = new Map<string, Context>();
  for (const c of contexts) if (c.title) contextByTitle.set(c.title, c);

  const result = new Map<number, SolvedAnswer>();

  for (const batch of chunk(questions, batchSize)) {
    const body = batch.map((q) => renderQuestion(q, contextByTitle)).join("\n\n---\n\n");

    const useThinking = thinkingBudget > 0 && client.provider === "anthropic";

    const msg = await client.createMessage({
      model,
      max_tokens: Math.max(maxTokens, useThinking ? thinkingBudget + 2000 : 0),
      system: SOLVER_SYSTEM,
      ...(useThinking
        ? { thinking: { type: "enabled" as const, budget_tokens: thinkingBudget } }
        : {}),
      messages: [
        {
          role: "user",
          content:
            `Resuelve estas ${batch.length} preguntas y devuelve SOLO el arreglo JSON:\n\n` + body,
        },
      ],
    });

    const parsed = extractJson(msg.text());
    const arr = Array.isArray(parsed) ? parsed : [];
    for (const item of arr) {
      const r = SolvedAnswerSchema.safeParse(item);
      if (r.success) result.set(r.data.number, r.data);
    }
  }

  return result;
}
