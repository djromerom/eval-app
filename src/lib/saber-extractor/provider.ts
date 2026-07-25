import AnthropicSdk from "@anthropic-ai/sdk";

export type ProviderType = "anthropic" | "minimax";

export interface ProviderConfig {
  type: ProviderType;
  anthropicApiKey?: string;
  minimaxApiKey?: string;
  minimaxBaseUrl?: string;
}

export interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  source?: { type: string; media_type: string; data: string };
  [key: string]: unknown;
}

export interface CreateMessageParams {
  model: string;
  max_tokens: number;
  system?: string | Array<{ type: string; text: string; cache_control?: { type: string } }>;
  tools?: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
  tool_choice?: { type: "tool"; name: string } | { type: "any" } | { type: "none" };
  thinking?: { type: "enabled"; budget_tokens: number };
  messages: Array<{
    role: "user" | "assistant";
    content: string | ContentBlock[];
  }>;
}

export interface AiResponse {
  content: ContentBlock[];
  text(): string;
  firstToolInput(toolName: string): unknown | null;
}

export interface AiClient {
  createMessage(params: CreateMessageParams): Promise<AiResponse>;
  provider: ProviderType;
}

/* ------------------------------------------------------------------ */
/*  Tool definition                                                    */
/* ------------------------------------------------------------------ */

export const EXTRACTION_TOOL: {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
} = {
  name: "emit_extraction",
  description: "Emite los contextos y preguntas extraídos del fragmento de examen recibido.",
  input_schema: {
    type: "object",
    properties: {
      contexts: {
        type: "array",
        description: "Contextos compartidos (lecturas, tablas, imágenes) que agrupan preguntas.",
        items: {
          type: "object",
          properties: {
            title: {
              type: ["string", "null"],
              description: "Título textual del contexto o null.",
            },
            text: {
              type: "string",
              description: "Texto completo del contexto, incluyendo [TABLA:...] e [IMAGEN N].",
            },
          },
          required: ["title", "text"],
        },
      },
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            number: {
              type: "integer",
              description: "Número impreso de la pregunta.",
            },
            contextTitle: {
              type: ["string", "null"],
              description: "Título del contexto al que pertenece, o null.",
            },
            text: { type: "string", description: "Enunciado (sin opciones)." },
            options: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  key: { type: "string", description: "A, B, C, D..." },
                  text: { type: "string" },
                },
                required: ["key", "text"],
              },
            },
            competency: { type: ["string", "null"] },
            evidence: { type: ["string", "null"] },
            imagePlaceholder: {
              type: ["string", "null"],
              description: 'Ej.: "!!IMAGEN 4!!" o null.',
            },
          },
          required: ["number", "contextTitle", "text", "options"],
        },
      },
    },
    required: ["contexts", "questions"],
  },
};

/** Propiedad `figures`, añadida solo cuando se van a recortar las imágenes. */
const FIGURES_PROPERTY: Record<string, unknown> = {
  type: "array",
  description: "Ubicación de cada figura en la página, para poder recortarla del PDF.",
  items: {
    type: "object",
    properties: {
      ref: {
        type: "integer",
        description: "El mismo N usado en [IMAGEN N] / !!IMAGEN N!!.",
      },
      page: {
        type: "integer",
        description: "Página dentro de este fragmento (1 = primera página recibida).",
      },
      bbox: {
        type: "array",
        items: { type: "number" },
        minItems: 4,
        maxItems: 4,
        description: "[x0,y0,x1,y1] normalizados 0-1, origen en la esquina superior izquierda.",
      },
      caption: { type: ["string", "null"] },
    },
    required: ["ref", "page", "bbox"],
  },
};

/**
 * Devuelve la definición de la herramienta de extracción. Con `withFigures`
 * se pide además la ubicación de cada figura; sin él, el esquema queda
 * idéntico al original (no cuesta tokens de más cuando no se usan imágenes).
 */
export function extractionTool(withFigures: boolean): typeof EXTRACTION_TOOL {
  if (!withFigures) return EXTRACTION_TOOL;
  const props = EXTRACTION_TOOL.input_schema["properties"] as Record<string, unknown>;
  return {
    ...EXTRACTION_TOOL,
    input_schema: {
      ...EXTRACTION_TOOL.input_schema,
      properties: { ...props, figures: FIGURES_PROPERTY },
      required: ["contexts", "questions", "figures"],
    },
  };
}

export const DEFAULT_MODELS: Record<
  ProviderType,
  {
    extractModel: string;
    solveModel: string;
    solveThinkingBudget: number;
  }
> = {
  anthropic: {
    extractModel: process.env.SABER_EXTRACT_MODEL ?? "claude-sonnet-5",
    solveModel: process.env.SABER_SOLVE_MODEL ?? "claude-opus-4-8",
    solveThinkingBudget: 4000,
  },
  minimax: {
    extractModel: process.env.SABER_EXTRACT_MODEL ?? "MiniMax-M3",
    solveModel: process.env.SABER_SOLVE_MODEL ?? "MiniMax-M3",
    solveThinkingBudget: 0,
  },
};

/* ------------------------------------------------------------------ */
/*  Factory                                                            */
/* ------------------------------------------------------------------ */

export function createProvider(config: ProviderConfig): AiClient {
  switch (config.type) {
    case "anthropic": {
      const key = config.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error("Falta ANTHROPIC_API_KEY.");
      return createAnthropicClient(key);
    }
    case "minimax": {
      const key = config.minimaxApiKey ?? process.env.MINIMAX_API_KEY;
      if (!key) throw new Error("Falta MINIMAX_API_KEY.");
      return createMinimaxClient(key);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Anthropic client (SDK)                                             */
/* ------------------------------------------------------------------ */

function createAnthropicClient(apiKey: string): AiClient {
  const client = new AnthropicSdk({ apiKey });
  return {
    provider: "anthropic",
    createMessage: async (params) => {
      const msg = await retry(() =>
        client.messages.create({
          model: params.model,
          max_tokens: params.max_tokens,
          ...(params.system !== undefined ? { system: params.system as any } : {}),
          ...(params.tools !== undefined ? { tools: params.tools as any } : {}),
          ...(params.tool_choice !== undefined ? { tool_choice: params.tool_choice as any } : {}),
          ...(params.thinking !== undefined
            ? {
                thinking: {
                  type: "enabled" as const,
                  budget_tokens: params.thinking.budget_tokens,
                },
              }
            : {}),
          messages: params.messages as any,
        }),
      );
      return buildResponse(msg.content as unknown as ContentBlock[]);
    },
  };
}

/* ------------------------------------------------------------------ */
/*  MiniMax client (HTTP direct, como el proyecto Python)              */
/* ------------------------------------------------------------------ */

function createMinimaxClient(apiKey: string): AiClient {
  const baseUrl = process.env.MINIMAX_BASE_URL ?? "https://api.minimax.io/anthropic/v1/messages";

  return {
    provider: "minimax",
    createMessage: async (params) => {
      const systemText =
        typeof params.system === "string"
          ? params.system
          : Array.isArray(params.system)
            ? params.system.map((b) => b.text).join("\n")
            : undefined;

      const messages: Array<{ role: string; content: unknown }> = [];
      for (const m of params.messages) {
        if (typeof m.content === "string") {
          messages.push({ role: m.role, content: m.content });
        } else {
          const converted: Array<Record<string, unknown>> = [];
          for (const block of m.content) {
            if (block.type === "text") {
              converted.push({ type: "text", text: block.text! });
            } else if (
              (block.type === "document" || block.type === "image") &&
              block.source?.type === "base64"
            ) {
              converted.push({ type: block.type, source: block.source });
            }
          }
          messages.push({ role: m.role, content: converted });
        }
      }

      const body: Record<string, unknown> = {
        model: params.model,
        max_tokens: params.max_tokens,
        messages,
      };
      if (systemText) body.system = systemText;
      if (params.tools) {
        body.tools = params.tools;
        if (params.tool_choice && "name" in params.tool_choice) {
          body.tool_choice = params.tool_choice;
        }
      }

      const resp = await retry(async () => {
        const res = await fetch(baseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw Object.assign(new Error(`${res.status} ${text}`), { status: res.status });
        }
        return res.json() as Promise<{
          content: ContentBlock[];
        }>;
      });

      return buildResponse(resp.content);
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                     */
/* ------------------------------------------------------------------ */

function buildResponse(content: ContentBlock[]): AiResponse {
  return {
    content,
    text() {
      return content
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("\n");
    },
    firstToolInput(toolName: string): unknown | null {
      for (const block of content) {
        if (block.type === "tool_use" && block.name === toolName) {
          return block.input ?? null;
        }
      }
      return null;
    },
  };
}

export function pdfBlock(base64: string): ContentBlock {
  return {
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data: base64 },
  };
}

export function imageBlock(base64: string, mediaType = "image/png"): ContentBlock {
  return {
    type: "image",
    source: { type: "base64", media_type: mediaType, data: base64 },
  };
}

/** Herramienta del pase de verificación de recortes. */
export const FIGURE_CHECK_TOOL: {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
} = {
  name: "emit_figure_check",
  description: "Reporta si el recorte contiene la figura completa y, si no, el bbox corregido.",
  input_schema: {
    type: "object",
    properties: {
      complete: {
        type: "boolean",
        description:
          "true si el recorte contiene la figura ENTERA; false si está cortada, " +
          "descuadrada o muestra otra cosa.",
      },
      bbox: {
        type: ["array", "null"],
        items: { type: "number" },
        minItems: 4,
        maxItems: 4,
        description:
          "Solo si complete=false: [x0,y0,x1,y1] normalizados 0-1 sobre la PÁGINA " +
          "completa, origen arriba-izquierda. null si complete=true.",
      },
      reason: {
        type: ["string", "null"],
        description: "Qué está mal, en pocas palabras.",
      },
    },
    required: ["complete", "bbox"],
  },
};

export function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* continue */
  }
  const startIdx = cleaned.search(/[[{]/);
  if (startIdx === -1) throw new Error("No se encontró JSON en la respuesta.");
  const open = cleaned[startIdx]!;
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = startIdx; i < cleaned.length; i++) {
    const ch = cleaned[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        return JSON.parse(cleaned.slice(startIdx, i + 1));
      }
    }
  }
  throw new Error("JSON incompleto o malformado en la respuesta.");
}

export async function retry<T>(
  fn: () => Promise<T>,
  { retries = 3, baseMs = 1200 }: { retries?: number; baseMs?: number } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      const retryable = status === undefined || status === 429 || (status >= 500 && status < 600);
      if (!retryable || attempt === retries) break;
      const wait = baseMs * 2 ** attempt;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}
