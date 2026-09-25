import type {
  LlmProvider,
  ProviderRequest,
  ProviderResponse,
} from "./client.js";
import { errorDiagnostic, errorMessage } from "./errors.js";

/** Longest server-requested wait honored before a request is failed instead. */
export const MAX_RETRY_WAIT_MS = 60_000;

/** Every later request fails the same way: bad key, no access, unknown model. */
const FATAL_STATUSES = new Set([401, 403, 404]);
/** A request-shape error can be per-symbol, so only a streak of them halts. */
const DETERMINISTIC_STATUSES = new Set([400, 422]);
const DETERMINISTIC_STREAK = 3;

export interface ProviderErrorInfo {
  readonly status?: number;
  readonly retryAfterMs?: number;
  /** Set by providers for errors no later request can recover from. */
  readonly fatal?: boolean;
}

export interface ProviderCallOptions {
  readonly failureState?: ProviderFailureState;
  readonly retryCount: number;
  readonly baseDelayMs: number;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly signal?: AbortSignal;
}

export interface ProviderFailureState {
  reason?: string;
}

export class ProviderFailure extends Error {
  readonly attempts: number;
  readonly diagnostic?: string;

  constructor(message: string, attempts: number, diagnostic?: string) {
    super(message);
    this.attempts = attempts;
    if (diagnostic !== undefined) this.diagnostic = diagnostic;
  }
}

/**
 * Send provider requests with bounded retries. Transient errors back off
 * exponentially or for the server's `Retry-After`; errors that would repeat
 * for every request halt the batch so the rest fail without being sent.
 */
export class ProviderCaller {
  readonly #provider: LlmProvider;
  readonly #options: ProviderCallOptions;
  #halted: string | undefined;
  #deterministicStreak = 0;

  constructor(provider: LlmProvider, options: ProviderCallOptions) {
    this.#provider = provider;
    this.#options = options;
  }

  /**
   * Send a request to the provider, retrying transient failures with backoff or
   * the server's Retry-After delay, and report how many attempts it took.
   * @param request Provider request to send. The same request is resent on each retry.
   * @returns The provider response and the number of attempts used, counting
   *   the successful one.
   */
  async complete(request: ProviderRequest): Promise<{
    readonly response: ProviderResponse;
    readonly attempts: number;
  }> {
    for (let attempt = 0; ; attempt++) {
      const halted = this.#options.failureState?.reason ?? this.#halted;
      if (halted !== undefined) {
        throw new ProviderFailure(
          `Not sent after an earlier provider error: ${halted}`,
          attempt,
        );
      }
      try {
        this.#options.signal?.throwIfAborted();
        const response = await this.#provider.complete({
          ...request,
          beforeSend: () => {
            request.beforeSend?.();
            this.#options.signal?.throwIfAborted();
            const reason = this.#options.failureState?.reason ?? this.#halted;
            if (reason !== undefined)
              throw new ProviderFailure(
                `Not sent after an earlier provider error: ${reason}`,
                0,
              );
          },
        });
        this.#deterministicStreak = 0;
        return { response, attempts: attempt + 1 };
      } catch (error) {
        if (error instanceof ProviderFailure) throw error;
        const info = this.#provider.errorInfo?.(error) ?? {};
        const wait =
          info.retryAfterMs ?? this.#options.baseDelayMs * Math.pow(2, attempt);
        const transient = this.#provider.isRetryable(error);
        const tooLong = transient && wait > MAX_RETRY_WAIT_MS;
        if (
          this.#options.signal?.aborted === true ||
          attempt >= this.#options.retryCount ||
          !transient ||
          tooLong
        ) {
          const message = tooLong
            ? `${errorMessage(error)} (provider asked to wait ${String(Math.ceil(wait / 1000))}s)`
            : errorMessage(error);
          this.#recordFailure(info, tooLong, message);
          throw new ProviderFailure(
            message,
            attempt + 1,
            errorDiagnostic(error),
          );
        }
        await this.#options.sleep(wait);
      }
    }
  }

  #recordFailure(
    info: ProviderErrorInfo,
    waitTooLong: boolean,
    message: string,
  ): void {
    const status = info.status ?? 0;
    this.#deterministicStreak = DETERMINISTIC_STATUSES.has(status)
      ? this.#deterministicStreak + 1
      : 0;
    if (
      info.fatal === true ||
      waitTooLong ||
      FATAL_STATUSES.has(status) ||
      this.#deterministicStreak >= DETERMINISTIC_STREAK
    ) {
      this.#halted ??= message;
      if (this.#options.failureState !== undefined)
        this.#options.failureState.reason ??= message;
    }
  }
}

/**
 * Map values with a bounded number of concurrent workers, preserving input order.
 * @param values Values to visit.
 * @param concurrency Maximum number of visits in flight.
 * @param visit Asynchronous visitor for each value.
 */
export const mapConcurrent = async <T, R>(
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
