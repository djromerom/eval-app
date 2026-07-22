export interface AiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function loadAiConfig(): AiConfig | null {
  const apiKey = process.env.MINIMAX_API_KEY?.trim();
  if (!apiKey) return null;

  let baseUrl = (process.env.MINIMAX_BASE_URL ?? "https://api.minimax.io")
    .trim()
    .replace(/\/+$/, "");

  // Normaliza URLs comunes de Minimax al formato base que necesitamos
  // (https://api.minimax.io/v1/...)
  //
  // Casos:
  //   https://api.minimax.io/anthropic            → https://api.minimax.io/v1
  //   https://api.minimax.io/anthropic/v1/messages → https://api.minimax.io/v1
  //   https://api.minimax.io/v1                    → https://api.minimax.io/v1
  //   https://api.minimax.io                      → https://api.minimax.io/v1

  if (baseUrl.includes("/anthropic")) {
    baseUrl = baseUrl.replace("/anthropic", "");
  }

  baseUrl = baseUrl.replace(/\/v1(\/messages)?\/?$/, "");

  return {
    apiKey,
    baseUrl: `${baseUrl}/v1`,
    model: (process.env.MINIMAX_MODEL ?? "MiniMax-M3").trim(),
  };
}
