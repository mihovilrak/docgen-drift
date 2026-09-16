import type { Symbol as DocumentationSymbol } from "../core/symbol.js";
import type { ModelCapabilities } from "./capabilities.js";
import {
  generationResponseJsonSchemaFor,
  parseGenerationResponse,
  type GenerationOutcome,
} from "./schema.js";
import { addUsage, EMPTY_USAGE, type ProviderUsage } from "./usage.js";

export type { CostBasis, ProviderUsage } from "./usage.js";
export { addUsage, EMPTY_USAGE, formatCost, usdUsage } from "./usage.js";

export interface ProviderRequest {
  readonly model: string;
  readonly system: string;
  readonly prompt: string;
  readonly responseSchema: Readonly<Record<string, unknown>>;
  readonly maxOutputTokens?: number;
  readonly signal?: AbortSignal;
}

export interface ProviderResponse {
  readonly value: unknown;
  readonly usage: ProviderUsage;
}

export interface LlmProvider {
  readonly id: string;
  complete(request: ProviderRequest): Promise<ProviderResponse>;
  isRetryable(error: unknown): boolean;
  /** Model limits, structured-output support, and price. Optional: callers fall back to conservative defaults. */
  describe?(model: string): ModelCapabilities;
  /** Local tokenizer. Optional: callers fall back to `conservativeTokenCount`. */
  countTokens?(text: string, model: string): number;
}

export interface GenerationRequest {
  readonly symbol: DocumentationSymbol;
  readonly model: string;
  readonly system: string;
  readonly prompt: string;
}

export interface GenerationResult {
  readonly symbolId: string;
  readonly outcome?: GenerationOutcome;
  readonly error?: string;
  readonly usage: ProviderUsage;
  readonly attempts: number;
}

export interface GenerationBatchResult {
  readonly results: readonly GenerationResult[];
  readonly usage: ProviderUsage;
}

export interface LlmClientOptions {
  readonly concurrency: number;
  readonly retryCount?: number;
  readonly baseDelayMs?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly maxOutputTokens?: number;
  readonly signal?: AbortSignal;
  readonly onResult?: (result: GenerationResult) => void;
}

export class LlmClient {
  readonly #provider: LlmProvider;
  readonly #options: LlmClientOptions &
    Required<Pick<LlmClientOptions, "retryCount" | "baseDelayMs" | "sleep">>;

  constructor(provider: LlmProvider, options: LlmClientOptions) {
    this.#provider = provider;
    this.#options = {
      ...options,
      retryCount: options.retryCount ?? 2,
      baseDelayMs: options.baseDelayMs ?? 250,
      sleep:
        options.sleep ??
        ((milliseconds) =>
          new Promise((resolve) => setTimeout(resolve, milliseconds))),
    };
  }

  async generate(
    requests: readonly GenerationRequest[],
  ): Promise<GenerationBatchResult> {
    const results = await mapConcurrent(
      requests,
      this.#options.concurrency,
      async (request) => {
        const result = await this.#generateOne(request);
        this.#options.onResult?.(result);
        return result;
      },
    );
    return {
      results,
      usage: results.reduce(
        (total, result) => addUsage(total, result.usage),
        EMPTY_USAGE,
      ),
    };
  }

  async #generateOne(request: GenerationRequest): Promise<GenerationResult> {
    let usage = EMPTY_USAGE;
    let attempts = 0;
    let validationError = "Invalid model response";
    for (
      let validationAttempt = 0;
      validationAttempt < 2;
      validationAttempt++
    ) {
      try {
        const response = await this.#completeWithRetry({
          model: request.model,
          system: request.system,
          prompt:
            validationAttempt === 0
              ? request.prompt
              : `${request.prompt}\n\nYour previous response was invalid: ${validationError}. Return a corrected JSON object.`,
          responseSchema: generationResponseJsonSchemaFor(request.symbol),
          ...optionalRequestFields(this.#options),
        });
        attempts += response.attempts;
        usage = addUsage(usage, response.response.usage);
        return {
          symbolId: request.symbol.id,
          outcome: parseGenerationResponse(
            response.response.value,
            request.symbol,
          ),
          usage,
          attempts,
        };
      } catch (error) {
        if (error instanceof ProviderFailure) {
          attempts += error.attempts;
          return {
            symbolId: request.symbol.id,
            error: error.message,
            usage,
            attempts,
          };
        }
        validationError = errorMessage(error);
      }
    }
    return {
      symbolId: request.symbol.id,
      error: validationError,
      usage,
      attempts,
    };
  }

  async #completeWithRetry(request: ProviderRequest): Promise<{
    readonly response: ProviderResponse;
    readonly attempts: number;
  }> {
    for (let attempt = 0; ; attempt++) {
      try {
        this.#options.signal?.throwIfAborted();
        return {
          response: await this.#provider.complete(request),
          attempts: attempt + 1,
        };
      } catch (error) {
        if (
          this.#options.signal?.aborted === true ||
          attempt >= this.#options.retryCount ||
          !this.#provider.isRetryable(error)
        ) {
          throw new ProviderFailure(errorMessage(error), attempt + 1);
        }
        await this.#options.sleep(
          this.#options.baseDelayMs * Math.pow(2, attempt),
        );
      }
    }
  }
}

class ProviderFailure extends Error {
  readonly attempts: number;

  constructor(message: string, attempts: number) {
    super(message);
    this.attempts = attempts;
  }
}

const mapConcurrent = async <T, R>(
  values: readonly T[],
  concurrency: number,
  visit: (value: T) => Promise<R>,
): Promise<readonly R[]> => {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor++;
        const value = values[index];
        if (value !== undefined) results[index] = await visit(value);
      }
    },
  );
  await Promise.all(workers);
  return results;
};

export const optionalRequestFields = (options: {
  readonly maxOutputTokens?: number;
  readonly signal?: AbortSignal;
}): Pick<ProviderRequest, "maxOutputTokens" | "signal"> => ({
  ...(options.maxOutputTokens === undefined
    ? {}
    : { maxOutputTokens: options.maxOutputTokens }),
  ...(options.signal === undefined ? {} : { signal: options.signal }),
});

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown provider error";
