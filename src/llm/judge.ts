import { z } from "zod";

import type {
  GeneratedDoc,
  Symbol as DocumentationSymbol,
} from "../core/symbol.js";
import {
  optionalRequestFields,
  type LlmProvider,
  type ProviderRequest,
  type ProviderResponse,
} from "./client.js";
import { judgePrompt, judgeSystemPrompt } from "./prompt/index.js";
import { portableJsonSchema } from "./schema.js";
import { addUsage, EMPTY_USAGE, type ProviderUsage } from "./usage.js";

const judgeResponseSchema = z
  .object({
    id: z.string().min(1),
    verdict: z.enum(["ACCEPT", "REJECT"]),
    reason: z.string().min(1),
  })
  .strict();

export const judgeResponseJsonSchema = portableJsonSchema(
  z.toJSONSchema(judgeResponseSchema),
) as Readonly<Record<string, unknown>>;

export interface JudgeRequest {
  readonly symbol: DocumentationSymbol;
  readonly doc: GeneratedDoc;
  readonly context: string;
  readonly model: string;
  readonly strict: boolean;
}

export interface JudgeResult {
  readonly symbolId: string;
  readonly accepted: boolean;
  readonly reason: string;
  readonly usage: ProviderUsage;
  readonly attempts: number;
  readonly error?: string;
}

export interface JudgeBatchResult {
  readonly results: readonly JudgeResult[];
  readonly usage: ProviderUsage;
}

export interface JudgeClientOptions {
  readonly concurrency: number;
  readonly retryCount?: number;
  readonly baseDelayMs?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly maxOutputTokens?: number;
  readonly signal?: AbortSignal;
}

export class JudgeClient {
  readonly #provider: LlmProvider;
  readonly #options: JudgeClientOptions &
    Required<Pick<JudgeClientOptions, "retryCount" | "baseDelayMs" | "sleep">>;

  constructor(provider: LlmProvider, options: JudgeClientOptions) {
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

  async judge(requests: readonly JudgeRequest[]): Promise<JudgeBatchResult> {
    const results = await mapConcurrent(
      requests,
      this.#options.concurrency,
      (request) => this.#judgeOne(request),
    );
    return {
      results,
      usage: results.reduce(
        (total, result) => addUsage(total, result.usage),
        EMPTY_USAGE,
      ),
    };
  }

  async #judgeOne(request: JudgeRequest): Promise<JudgeResult> {
    let usage = EMPTY_USAGE;
    let attempts = 0;
    let validationError = "Invalid judge response";
    for (
      let validationAttempt = 1;
      validationAttempt <= 2;
      validationAttempt++
    ) {
      try {
        const completed = await this.#completeWithRetry({
          model: request.model,
          system: judgeSystemPrompt,
          prompt: appendValidationFeedback(
            judgePrompt(
              request.symbol,
              request.doc,
              request.context,
              request.strict,
            ),
            validationAttempt,
            validationError,
          ),
          responseSchema: judgeResponseJsonSchema,
          ...optionalRequestFields(this.#options),
        });
        attempts += completed.attempts;
        const response = completed.response;
        usage = addUsage(usage, response.usage);
        const parsed = judgeResponseSchema.parse(
          typeof response.value === "string"
            ? JSON.parse(response.value)
            : response.value,
        );
        if (parsed.id !== request.symbol.id) {
          throw new Error(
            `Judge response id ${parsed.id} does not match ${request.symbol.id}`,
          );
        }
        return {
          symbolId: request.symbol.id,
          accepted: parsed.verdict === "ACCEPT",
          reason: parsed.reason.trim(),
          usage,
          attempts,
        };
      } catch (error) {
        if (error instanceof JudgeProviderFailure) {
          attempts += error.attempts;
          return {
            symbolId: request.symbol.id,
            accepted: false,
            reason: "Judge failed; generated documentation was not applied",
            usage,
            attempts,
            error: error.message,
          };
        }
        validationError = errorMessage(error);
        if (validationAttempt === 2) {
          return {
            symbolId: request.symbol.id,
            accepted: false,
            reason: "Judge failed; generated documentation was not applied",
            usage,
            attempts,
            error: validationError,
          };
        }
      }
    }
    throw new Error("Unreachable judge state");
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
          throw new JudgeProviderFailure(errorMessage(error), attempt + 1);
        }
        await this.#options.sleep(
          this.#options.baseDelayMs * Math.pow(2, attempt),
        );
      }
    }
  }
}

class JudgeProviderFailure extends Error {
  readonly attempts: number;

  constructor(message: string, attempts: number) {
    super(message);
    this.attempts = attempts;
  }
}

const appendValidationFeedback = (
  prompt: string,
  attempt: number,
  error: string,
): string =>
  attempt === 1
    ? prompt
    : `${prompt}\n\nYour previous response was invalid: ${error}. Return a corrected JSON object.`;

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

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown judge error";
