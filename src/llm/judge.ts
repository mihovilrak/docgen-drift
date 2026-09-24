import { z } from "zod";

import type {
  GeneratedDoc,
  Symbol as DocumentationSymbol,
} from "../core/symbol.js";
import { mapConcurrent, ProviderCaller, ProviderFailure } from "./call.js";
import {
  callOptions,
  optionalRequestFields,
  type LlmProvider,
} from "./client.js";
import {
  DEFAULT_OUTPUT_POLICY,
  type GenerationOutputPolicy,
} from "./outputPolicy.js";
import { judgePrompt, judgeSystemPrompt } from "./prompt/index.js";
import { portableJsonSchema } from "./schema.js";
import { addUsage, EMPTY_USAGE, type ProviderUsage } from "./usage.js";
import { errorMessage } from "./errors.js";

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
  /** Shared module outline; the judge needs it or claims it supports read as unsupported. */
  readonly prefix?: string;
  readonly model: string;
  readonly strict: boolean;
  readonly output?: GenerationOutputPolicy;
}

export interface JudgeResult {
  readonly symbolId: string;
  readonly accepted: boolean;
  readonly reason: string;
  readonly usage: ProviderUsage;
  readonly attempts: number;
  readonly error?: string;
  readonly diagnostic?: string;
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
  readonly onResult?: (result: JudgeResult) => void;
}

/**
 * Evaluate generated documentation concurrently against a language-model provider with retries and response validation.
 */
export class JudgeClient {
  readonly #caller: ProviderCaller;
  readonly #options: JudgeClientOptions;

  constructor(provider: LlmProvider, options: JudgeClientOptions) {
    this.#options = options;
    this.#caller = new ProviderCaller(provider, callOptions(options));
  }

  /**
   * Evaluate documentation requests concurrently and aggregate their results with total provider usage.
   * @param requests Documentation judging requests to process.
   * @returns A batch containing each judge result and the aggregated provider usage.
   */
  async judge(requests: readonly JudgeRequest[]): Promise<JudgeBatchResult> {
    const results = await mapConcurrent(
      requests,
      this.#options.concurrency,
      async (request) => {
        const result = await this.#judgeOne(request);
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
        const completed = await this.#caller.complete({
          model: request.model,
          system: judgeSystemPrompt,
          ...(request.prefix === undefined ? {} : { prefix: request.prefix }),
          prompt: appendValidationFeedback(
            judgePrompt(
              request.symbol,
              request.doc,
              request.context,
              request.strict,
              request.output ?? DEFAULT_OUTPUT_POLICY,
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
        if (error instanceof ProviderFailure) {
          attempts += error.attempts;
          return {
            symbolId: request.symbol.id,
            accepted: false,
            reason: "Judge failed; generated documentation was not applied",
            usage,
            attempts,
            error: error.message,
            ...(error.diagnostic === undefined
              ? {}
              : { diagnostic: error.diagnostic }),
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
}

const appendValidationFeedback = (
  prompt: string,
  attempt: number,
  error: string,
): string =>
  attempt === 1
    ? prompt
    : `${prompt}\n\nYour previous response was invalid: ${error}. Return a corrected JSON object.`;
