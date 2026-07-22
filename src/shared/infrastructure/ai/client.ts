import type { AiConfig } from "./config";

interface OpenAiResponse {
  choices: { message: { content: string } }[];
}

export class AiClient {
  constructor(private readonly config: AiConfig) {}

  async chat(params: {
    system?: string;
    messages: { role: "user"; content: string }[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<string> {
    const openAiMessages: { role: string; content: string }[] = [];
    if (params.system) {
      openAiMessages.push({ role: "system", content: params.system });
    }
    openAiMessages.push(...params.messages);

    const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: openAiMessages,
        max_tokens: params.maxTokens ?? 8192,
        temperature: params.temperature ?? 0.1,
      }),
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      throw new Error(`Minimax API error ${res.status}: ${bodyText}`);
    }

    const json = (await res.json()) as OpenAiResponse;
    return json.choices[0]?.message?.content ?? "";
  }
}
