import {
  DEFAULT_MAX_OUTPUT_TOKENS,
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

export const GOOGLE_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";

export const GOOGLE_CONTEXT_WINDOW_TOKENS = 1_000_000;

/** Prefix match: list a longer name before any name it starts with. Pro rates are the <=200k-context tier. */
const PRICES: readonly (readonly [string, ModelPrice])[] = [
  [
    "gemini-3.5-flash-lite",
    { inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5 },
  ],
  ["gemini-3.5-flash", { inputUsdPerMillion: 1.5, outputUsdPerMillion: 9 }],
  [
    "gemini-3.1-flash-lite",
    { inputUsdPerMillion: 0.25, outputUsdPerMillion: 1.5 },
  ],
  ["gemini-3.1-pro", { inputUsdPerMillion: 2, outputUsdPerMillion: 12 }],
  ["gemini-3-pro", { inputUsdPerMillion: 2, outputUsdPerMillion: 12 }],
  ["gemini-3-flash", { inputUsdPerMillion: 0.5, outputUsdPerMillion: 3 }],
  [
    "gemini-2.5-flash-lite",
    { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.4 },
  ],
  ["gemini-2.5-flash", { inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5 }],
  ["gemini-2.5-pro", { inputUsdPerMillion: 1.25, outputUsdPerMillion: 10 }],
];

export const googlePrice = (model: string): ModelPrice | undefined =>
  PRICES.find(([name]) => model.startsWith(name))?.[1];

export interface GoogleProviderOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly maxOutputTokens?: number;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Provide an LLM provider that sends JSON-schema-constrained prompts to
 * Google's Gemini generateContent API and reports text output, token usage,
 * retry behavior, and model capabilities.
 */
export class GoogleProvider implements LlmProvider {
  readonly id = "google";
  readonly #options: GoogleProviderOptions;

  constructor(options: GoogleProviderOptions) {
    this.#options = options;
  }

  /**
   * Generate structured JSON content with Google’s supported schema keywords and return its value with usage data.
   * @param request Specify the model, system instructions, prompt, response schema, and optional token limit or cancellation signal.
   * @returns A promise resolving to the generated response value and provider usage data.
   */
  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const base = (this.#options.baseUrl ?? GOOGLE_BASE_URL).replace(/\/+$/, "");
    const payload = await postJson({
      url: `${base}/models/${encodeURIComponent(request.model)}:generateContent`,
      headers: { "x-goog-api-key": this.#options.apiKey },
      body: {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [
          { role: "user", parts: [{ text: promptWithPrefix(request) }] },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: googleJsonSchema(request.responseSchema),
          maxOutputTokens:
            request.maxOutputTokens ??
            this.#options.maxOutputTokens ??
            DEFAULT_MAX_OUTPUT_TOKENS,
        },
      },
      timeoutMs: this.#options.timeoutMs ?? 120_000,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      label: this.id,
      ...(this.#options.fetchImpl === undefined
        ? {}
        : { fetchImpl: this.#options.fetchImpl }),
    });
    return { value: textOf(payload), usage: usageOf(payload, request.model) };
  }

  /**
   * Determine whether the error represents a transient HTTP failure worth retrying.
   * @param error Error value to evaluate for retry eligibility.
   */
  isRetryable(error: unknown): boolean {
    return isRetryableHttpError(error);
  }

  /**
   * Extract HTTP status, retry delay, and fatality details from a failed Google
   * API call using the shared HTTP error parser.
   * @param error The value thrown or rejected by a failed request, of unknown type.
   * @returns Error metadata with optional HTTP status, retry-after delay in
   *   milliseconds, and a fatal flag.
   */
  errorInfo(error: unknown): ProviderErrorInfo {
    return httpErrorInfo(error);
  }

  /**
   * Report the context window, output token limit, and pricing capabilities for
   * a Google model.
   * @param model Google model identifier used to look up pricing and echoed in
   *   the returned capabilities.
   * @returns Capabilities using the fixed Google context window, the provider's
   *   configured maxOutputTokens (or the default when unset), and the model's
   *   price if one is known.
   */
  describe(model: string): ModelCapabilities {
    return pricedCapabilities(
      model,
      GOOGLE_CONTEXT_WINDOW_TOKENS,
      this.#options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      googlePrice(model),
    );
  }
}

const textOf = (payload: Record<string, unknown>): string => {
  const candidates = payload["candidates"];
  const first = Array.isArray(candidates)
    ? (candidates[0] as unknown)
    : undefined;
  const content =
    typeof first === "object" && first !== null
      ? (first as Record<string, unknown>)["content"]
      : undefined;
  const parts =
    typeof content === "object" && content !== null
      ? (content as Record<string, unknown>)["parts"]
      : undefined;
  const text = Array.isArray(parts)
    ? parts
        .map((part) =>
          typeof part === "object" && part !== null
            ? (part as Record<string, unknown>)["text"]
            : undefined,
        )
        .filter((value): value is string => typeof value === "string")
        .join("")
    : "";
  if (text === "")
    throw new HttpProviderError("google returned no text response");
  return text;
};

const GOOGLE_UNSUPPORTED_SCHEMA_KEYS = new Set([
  "$schema",
  "minLength",
  "propertyNames",
]);

const googleJsonSchema = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(googleJsonSchema);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !GOOGLE_UNSUPPORTED_SCHEMA_KEYS.has(key))
      .map(([key, nested]) => [key, googleJsonSchema(nested)]),
  );
};

const usageOf = (
  payload: Record<string, unknown>,
  model: string,
): ProviderUsage => {
  const metadata =
    typeof payload["usageMetadata"] === "object" &&
    payload["usageMetadata"] !== null
      ? (payload["usageMetadata"] as Record<string, unknown>)
      : {};
  const inputTokens = numberAt(metadata, "promptTokenCount");
  const outputTokens = numberAt(metadata, "candidatesTokenCount");
  const price = googlePrice(model);
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
};
