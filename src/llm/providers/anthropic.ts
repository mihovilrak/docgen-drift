import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from "@anthropic-ai/sdk";

import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  pricedCapabilities,
  type ModelCapabilities,
  type ModelPrice,
} from "../capabilities.js";
import type {
  LlmProvider,
  ProviderRequest,
  ProviderResponse,
} from "../client.js";
import { usdUsage, type ProviderUsage } from "../usage.js";

export interface AnthropicProviderOptions {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly maxOutputTokens?: number;
  readonly client?: Anthropic;
}

export const ANTHROPIC_CONTEXT_WINDOW_TOKENS = 200_000;

const PRICES: readonly (readonly [string, ModelPrice])[] = [
  ["sonnet", { inputUsdPerMillion: 3, outputUsdPerMillion: 15 }],
  ["haiku", { inputUsdPerMillion: 1, outputUsdPerMillion: 5 }],
  ["opus", { inputUsdPerMillion: 5, outputUsdPerMillion: 25 }],
];

export const anthropicPrice = (model: string): ModelPrice | undefined => {
  if (model.includes("sonnet-5")) {
    return { inputUsdPerMillion: 2, outputUsdPerMillion: 10 };
  }
  return PRICES.find(([name]) => model.includes(name))?.[1];
};

export class AnthropicProvider implements LlmProvider {
  readonly id = "anthropic";
  readonly #client: Anthropic;
  readonly #maxOutputTokens: number;

  constructor(options: AnthropicProviderOptions = {}) {
    this.#maxOutputTokens =
      options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.#client =
      options.client ??
      new Anthropic({
        ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
        ...(options.baseUrl === undefined ? {} : { baseURL: options.baseUrl }),
        maxRetries: 0,
      });
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const message = await this.#client.messages.create(
      {
        model: request.model,
        max_tokens: request.maxOutputTokens ?? this.#maxOutputTokens,
        system: request.system,
        messages: [{ role: "user", content: request.prompt }],
        output_config: {
          format: { type: "json_schema", schema: request.responseSchema },
        },
      },
      request.signal === undefined ? undefined : { signal: request.signal },
    );
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
      usage: cachedUsage(request.model, {
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

  describe(model: string): ModelCapabilities {
    return pricedCapabilities(
      model,
      ANTHROPIC_CONTEXT_WINDOW_TOKENS,
      this.#maxOutputTokens,
      anthropicPrice(model),
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

/** Cache writes and reads are billed at different multiples of the input rate. */
const cachedUsage = (
  model: string,
  usage: AnthropicTokenUsage,
): ProviderUsage => {
  const price = anthropicPrice(model);
  const inputTokens =
    usage.inputTokens +
    usage.cacheCreation5m +
    usage.cacheCreation1h +
    usage.cacheReadTokens;
  if (price === undefined) {
    return {
      inputTokens,
      outputTokens: usage.outputTokens,
      costBasis: "unknown",
    };
  }
  return usdUsage(
    inputTokens,
    usage.outputTokens,
    (usage.inputTokens * price.inputUsdPerMillion +
      usage.cacheCreation5m * price.inputUsdPerMillion * 1.25 +
      usage.cacheCreation1h * price.inputUsdPerMillion * 2 +
      usage.cacheReadTokens * price.inputUsdPerMillion * 0.1 +
      usage.outputTokens * price.outputUsdPerMillion) /
      1_000_000,
  );
};
