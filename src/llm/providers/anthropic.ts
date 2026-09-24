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
import type { ProviderErrorInfo } from "../call.js";
import type {
  LlmProvider,
  ProviderRequest,
  ProviderResponse,
} from "../client.js";
import { usdUsage, type ProviderUsage } from "../usage.js";
import { parseRetryAfterMs } from "./http.js";

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

/**
 * Resolve the model’s per-million-token Anthropic pricing, including special Sonnet 5 rates, and leave unsupported models unknown.
 * @param model Model identifier used to select the applicable Anthropic pricing.
 * @returns Return input and output USD rates per million tokens, or undefined when the model has no known price.
 */
export const anthropicPrice = (model: string): ModelPrice | undefined => {
  if (model.includes("sonnet-5")) {
    return { inputUsdPerMillion: 2, outputUsdPerMillion: 10 };
  }
  return PRICES.find(([name]) => model.includes(name))?.[1];
};

/**
 * Anthropic structured output rejects array `maxItems`; the prompt and
 * output projection still keep disabled sections empty.
 */
const anthropicSchema = (
  schema: Readonly<Record<string, unknown>>,
): Record<string, unknown> =>
  JSON.parse(
    JSON.stringify(schema, (key, value: unknown) =>
      key === "maxItems" ? undefined : value,
    ),
  ) as Record<string, unknown>;

/**
 * Split the shared prefix into its own cache-controlled block so a batch of
 * requests over the same module pays for it once and reads it thereafter.
 */
const userContent = (
  request: ProviderRequest,
): Anthropic.Messages.ContentBlockParam[] =>
  request.prefix === undefined || request.prefix === ""
    ? [{ type: "text", text: request.prompt }]
    : [
        {
          type: "text",
          text: request.prefix,
          cache_control: { type: "ephemeral" },
        },
        { type: "text", text: request.prompt },
      ];

/**
 * Configure Anthropic-backed completions with JSON output, usage accounting, and retry classification.
 */
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

  /**
   * Generate a JSON-schema-conforming response through Anthropic and record token usage, including prompt-cache activity.
   * @param request Specify the model, system and user prompts, response schema, optional output-token limit, and optional cancellation signal.
   * @returns Resolve with the generated text and its token-usage accounting.
   */
  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const message = await this.#client.messages.create(
      {
        model: request.model,
        max_tokens: request.maxOutputTokens ?? this.#maxOutputTokens,
        system: [
          {
            type: "text",
            text: request.system,
            // Cacheable prefix. Anthropic ignores a prefix shorter than the
            // per-model minimum (1024 tokens on Sonnet and Opus) instead of
            // charging the write premium, so this is free until a shared
            // prefix is large enough to hit.
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: userContent(request) }],
        output_config: {
          format: {
            type: "json_schema",
            schema: anthropicSchema(request.responseSchema),
          },
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

  /**
   * Treat connection failures and transient HTTP statuses as retryable.
   * @param error The unknown error to classify for retry eligibility.
   */
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

  /**
   * Extract the HTTP status and retry-after delay from an Anthropic SDK API
   * error for use in retry handling.
   * @param error Value thrown by a request; only Anthropic APIError instances
   *   yield information.
   * @returns Error info with the numeric status when present and retryAfterMs
   *   when a valid retry-after header exists; an empty object for non-API
   *   errors or when neither is available.
   */
  errorInfo(error: unknown): ProviderErrorInfo {
    if (!(error instanceof APIError)) return {};
    const status: unknown = error.status;
    const headers: unknown = error.headers;
    const retryAfterMs = parseRetryAfterMs(
      headers instanceof Headers ? headers.get("retry-after") : undefined,
    );
    return {
      ...(typeof status === "number" ? { status } : {}),
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    };
  }

  /**
   * Report the capabilities of an Anthropic model, combining the fixed
   * Anthropic context window, this provider's configured maximum output tokens,
   * and any known pricing for the model.
   * @param model Anthropic model identifier to look up pricing and capabilities for.
   * @returns Capabilities for the model, including its price when one is known
   *   for that model.
   */
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
