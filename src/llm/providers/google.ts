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
import {
  HttpProviderError,
  isRetryableHttpError,
  numberAt,
  postJson,
} from "./http.js";

export const GOOGLE_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";

export const GOOGLE_CONTEXT_WINDOW_TOKENS = 1_000_000;

const PRICES: readonly (readonly [string, ModelPrice])[] = [
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

export class GoogleProvider implements LlmProvider {
  readonly id = "google";
  readonly #options: GoogleProviderOptions;

  constructor(options: GoogleProviderOptions) {
    this.#options = options;
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const base = (this.#options.baseUrl ?? GOOGLE_BASE_URL).replace(/\/+$/, "");
    const payload = await postJson({
      url: `${base}/models/${encodeURIComponent(request.model)}:generateContent`,
      headers: { "x-goog-api-key": this.#options.apiKey },
      body: {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: "user", parts: [{ text: request.prompt }] }],
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

  isRetryable(error: unknown): boolean {
    return isRetryableHttpError(error);
  }

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
