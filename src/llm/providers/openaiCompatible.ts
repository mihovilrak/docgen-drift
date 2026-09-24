import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  FALLBACK_CONTEXT_WINDOW_TOKENS,
  pricedCapabilities,
  type ModelCapabilities,
  type ModelPrice,
} from "../capabilities.js";
import type { ProviderErrorInfo } from "../call.js";
import {
  promptWithPrefix,
  type LlmProvider,
  type ProviderRequest,
  type ProviderResponse,
} from "../client.js";
import { usdUsage, type ProviderUsage } from "../usage.js";
import {
  HttpProviderError,
  httpErrorInfo,
  isRetryableHttpError,
  numberAt,
  postJson,
} from "./http.js";

export interface OpenAiCompatibleOptions {
  readonly id: string;
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly maxOutputTokens?: number;
  readonly timeoutMs?: number;
  readonly contextWindowTokens?: number;
  readonly maxTokensField?: "max_tokens" | "max_completion_tokens";
  readonly price?: (model: string) => ModelPrice | undefined;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Use configured OpenAI-compatible endpoints to request schema-constrained completions and report model capabilities.
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly id: string;
  readonly #options: OpenAiCompatibleOptions;

  constructor(options: OpenAiCompatibleOptions) {
    this.id = options.id;
    this.#options = options;
  }

  /**
   * Send a strict JSON-schema chat completion request to the configured
   * OpenAI-compatible endpoint and return the parsed content with token usage.
   * @param request Provider request supplying the model, system prompt, prompt
   *   (with optional prefix), response JSON schema, an optional output-token
   *   cap that overrides the provider default, and an optional abort signal.
   * @returns Response whose value is the model's message content extracted from
   *   the completion payload and whose usage is the token usage reported by the server.
   */
  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const maxTokens =
      request.maxOutputTokens ??
      this.#options.maxOutputTokens ??
      DEFAULT_MAX_OUTPUT_TOKENS;
    const body = {
      model: request.model,
      [this.#options.maxTokensField ?? "max_tokens"]: maxTokens,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: promptWithPrefix(request) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "docgen_response",
          strict: true,
          schema: request.responseSchema,
        },
      },
    };
    const payload = await postJson({
      url: `${trimSlash(this.#options.baseUrl)}/chat/completions`,
      headers:
        this.#options.apiKey === undefined
          ? {}
          : { authorization: `Bearer ${this.#options.apiKey}` },
      body,
      timeoutMs: this.#options.timeoutMs ?? 120_000,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      label: this.id,
      ...(this.#options.fetchImpl === undefined
        ? {}
        : { fetchImpl: this.#options.fetchImpl }),
    });
    return { value: contentOf(payload, this.id), usage: this.#usage(payload) };
  }

  /**
   * Determine whether the error represents a retryable HTTP provider failure.
   * @param error The error to evaluate.
   */
  isRetryable(error: unknown): boolean {
    return isRetryableHttpError(error);
  }

  /**
   * Extract HTTP status, retry delay, and fatality hints from a failed request
   * error using the shared HTTP error parser.
   * @param error The error thrown by a failed provider call, of any type;
   *   inspected for HTTP error details.
   * @returns Error metadata with the optional HTTP status, retry-after delay in
   *   milliseconds, and fatal flag.
   */
  errorInfo(error: unknown): ProviderErrorInfo {
    return httpErrorInfo(error);
  }

  /**
   * Describe the model using configured or fallback capability limits and optional pricing information.
   * @param model Identify the model whose capabilities and pricing should be resolved.
   * @returns Return the model's capabilities, including context and output limits, structured-output support, cost basis, and optional pricing.
   */
  describe(model: string): ModelCapabilities {
    return pricedCapabilities(
      model,
      this.#options.contextWindowTokens ?? FALLBACK_CONTEXT_WINDOW_TOKENS,
      this.#options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      this.#options.price?.(model),
    );
  }

  #usage(payload: Record<string, unknown>): ProviderUsage {
    const usage =
      typeof payload["usage"] === "object" && payload["usage"] !== null
        ? (payload["usage"] as Record<string, unknown>)
        : {};
    const inputTokens = numberAt(usage, "prompt_tokens");
    const outputTokens = numberAt(usage, "completion_tokens");
    const price = this.#options.price?.(
      typeof payload["model"] === "string" ? payload["model"] : "",
    );
    if (price === undefined) {
      return { inputTokens, outputTokens, costBasis: "unknown" };
    }
    return usdUsage(
      inputTokens,
      outputTokens,
      (inputTokens * price.inputUsdPerMillion +
        outputTokens * price.outputUsdPerMillion) /
        1_000_000,
    );
  }
}

const trimSlash = (value: string): string => value.replace(/\/+$/, "");

const contentOf = (payload: Record<string, unknown>, id: string): string => {
  const choices = payload["choices"];
  const first = Array.isArray(choices) ? (choices[0] as unknown) : undefined;
  const message =
    typeof first === "object" && first !== null
      ? (first as Record<string, unknown>)["message"]
      : undefined;
  const content =
    typeof message === "object" && message !== null
      ? (message as Record<string, unknown>)["content"]
      : undefined;
  if (typeof content !== "string" || content === "") {
    throw new HttpProviderError(`${id} returned no text response`);
  }
  return content;
};
