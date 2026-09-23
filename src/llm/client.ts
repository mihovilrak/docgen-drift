import type { Symbol as DocumentationSymbol } from "../core/symbol.js";
import type { ModelCapabilities } from "./capabilities.js";
import { errorDiagnostic, errorMessage } from "./errors.js";
import type { GenerationOutputPolicy } from "./outputPolicy.js";
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
  /** Content shared by a batch of requests, sent ahead of the prompt so providers can cache it. */
  readonly prefix?: string;
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
  readonly prefix?: string;
  readonly prompt: string;
  readonly outputPolicy?: GenerationOutputPolicy;
}

export interface GenerationResult {
  readonly symbolId: string;
  readonly outcome?: GenerationOutcome;
  readonly error?: string;
  readonly diagnostic?: string;
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

/**
 * Coordinate concurrent LLM generation with retries, validation, usage aggregation, and result reporting.
 */
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

  /**
   * Generate documentation results concurrently for the supplied requests and aggregate their provider usage.
   * @param requests Requests containing the symbols, model settings, prompts, and output policies to process.
   * @returns A batch containing each generation result and the combined provider usage for completed results.
   */
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
          ...(request.prefix === undefined ? {} : { prefix: request.prefix }),
          prompt:
            validationAttempt === 0
              ? request.prompt
              : `${request.prompt}\n\nYour previous response was invalid: ${validationError}. Return a corrected JSON object.`,
          responseSchema: generationResponseJsonSchemaFor(
            request.symbol,
            request.outputPolicy,
          ),
          ...optionalRequestFields(this.#options),
        });
        attempts += response.attempts;
        usage = addUsage(usage, response.response.usage);
        return {
          symbolId: request.symbol.id,
          outcome: parseGenerationResponse(
            response.response.value,
            request.symbol,
            request.outputPolicy,
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
            ...(error.diagnostic === undefined
              ? {}
              : { diagnostic: error.diagnostic }),
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
          throw new ProviderFailure(
            errorMessage(error),
            attempt + 1,
            errorDiagnostic(error),
          );
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
  readonly diagnostic?: string;

  constructor(message: string, attempts: number, diagnostic?: string) {
    super(message);
    this.attempts = attempts;
    if (diagnostic !== undefined) this.diagnostic = diagnostic;
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

/**
 * Inline a shared prefix for providers without a cache-control mechanism of their own.
 * @param request Request whose prompt is returned, preceded by its prefix when one is set.
 */
export const promptWithPrefix = (
  request: Pick<ProviderRequest, "prefix" | "prompt">,
): string =>
  request.prefix === undefined || request.prefix === ""
    ? request.prompt
    : `${request.prefix}\n\n${request.prompt}`;

/**
 * Forward defined request controls without adding unset fields.
 * @param options Optional maximum output token and cancellation-signal settings to include in the provider request when defined.
 */
export const optionalRequestFields = (options: {
  readonly maxOutputTokens?: number;
  readonly signal?: AbortSignal;
}): Pick<ProviderRequest, "maxOutputTokens" | "signal"> => ({
  ...(options.maxOutputTokens === undefined
    ? {}
    : { maxOutputTokens: options.maxOutputTokens }),
  ...(options.signal === undefined ? {} : { signal: options.signal }),
});
