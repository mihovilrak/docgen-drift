import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from "@anthropic-ai/sdk";

import type {
  LlmProvider,
  ProviderRequest,
  ProviderResponse,
} from "../client.js";
import { priceForModel } from "../cost.js";

export interface AnthropicProviderOptions {
  readonly apiKey?: string;
  readonly client?: Anthropic;
}

export class AnthropicProvider implements LlmProvider {
  readonly id = "anthropic";
  readonly #client: Anthropic;

  constructor(options: AnthropicProviderOptions = {}) {
    this.#client =
      options.client ??
      new Anthropic({
        ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
        maxRetries: 0,
      });
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const message = await this.#client.messages.create({
      model: request.model,
      max_tokens: 1200,
      system: request.system,
      messages: [{ role: "user", content: request.prompt }],
      output_config: {
        format: { type: "json_schema", schema: request.responseSchema },
      },
    });
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    if (text === "") throw new Error("Anthropic returned no text response");
    const cacheCreation = message.usage.cache_creation_input_tokens;
    const cacheRead = message.usage.cache_read_input_tokens;
    const cacheCreation5m =
      message.usage.cache_creation?.ephemeral_5m_input_tokens ??
      (typeof cacheCreation === "number" ? cacheCreation : 0);
    const cacheCreation1h =
      message.usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    const cacheReadTokens = typeof cacheRead === "number" ? cacheRead : 0;
    return {
      value: text,
      usage: costForModel(request.model, {
        inputTokens: message.usage.input_tokens,
        cacheCreation5m,
        cacheCreation1h,
        cacheReadTokens,
        outputTokens: message.usage.output_tokens,
      }),
    };
  }

  isRetryable(error: unknown): boolean {
    if (
      error instanceof APIConnectionError ||
      error instanceof APIConnectionTimeoutError
    ) {
      return true;
    }
    if (!(error instanceof APIError)) return false;
    const status: unknown = error.status;
    return (
      status === undefined ||
      (typeof status === "number" &&
        ([408, 409, 429].includes(status) || status >= 500))
    );
  }
}

interface AnthropicTokenUsage {
  readonly inputTokens: number;
  readonly cacheCreation5m: number;
  readonly cacheCreation1h: number;
  readonly cacheReadTokens: number;
  readonly outputTokens: number;
}

const costForModel = (
  model: string,
  usage: AnthropicTokenUsage,
): ProviderResponse["usage"] => {
  const price = priceForModel(model);
  return {
    inputTokens:
      usage.inputTokens +
      usage.cacheCreation5m +
      usage.cacheCreation1h +
      usage.cacheReadTokens,
    outputTokens: usage.outputTokens,
    costUsd:
      price === undefined
        ? 0
        : (usage.inputTokens * price.inputUsdPerMillion +
            usage.cacheCreation5m * price.inputUsdPerMillion * 1.25 +
            usage.cacheCreation1h * price.inputUsdPerMillion * 2 +
            usage.cacheReadTokens * price.inputUsdPerMillion * 0.1 +
            usage.outputTokens * price.outputUsdPerMillion) /
          1_000_000,
  };
};
