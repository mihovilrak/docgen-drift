import type {
  LlmProvider,
  ProviderRequest,
  ProviderResponse,
} from "./client.js";

const MINUTE_MS = 60_000;

export interface PacingLimits {
  readonly requestsPerMinute?: number;
  readonly requestsPerDay?: number;
}

export interface PacingClock {
  readonly now: () => number;
  readonly sleep: (milliseconds: number) => Promise<void>;
}

export class RequestQuotaError extends Error {}

const systemClock: PacingClock = {
  now: Date.now,
  sleep: (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

/**
 * Pace request starts to a sliding one-minute window and stop at a per-run
 * request cap. Shared by generation and judge when they use one provider.
 * @param inner Provider whose requests are paced.
 * @param limits Requests per minute and per run; unset limits are not enforced.
 * @param clock Time source and sleep, injectable for tests.
 */
export const pacedProvider = (
  inner: LlmProvider,
  limits: PacingLimits,
  clock: PacingClock = systemClock,
): LlmProvider => {
  let starts: number[] = [];
  let sent = 0;
  let queue: Promise<void> = Promise.resolve();

  const acquire = async (request: ProviderRequest): Promise<void> => {
    request.signal?.throwIfAborted();
    request.beforeSend?.();
    const { requestsPerMinute: perMinute, requestsPerDay: perDay } = limits;
    if (perDay !== undefined && sent >= perDay) {
      throw new RequestQuotaError(
        `${inner.id} reached requestsPerDay (${String(perDay)}) for this run`,
      );
    }
    if (perMinute !== undefined) {
      for (;;) {
        const now = clock.now();
        starts = starts.filter((start) => now - start < MINUTE_MS);
        const oldest = starts[0];
        if (starts.length < perMinute || oldest === undefined) break;
        await clock.sleep(MINUTE_MS - (now - oldest));
        request.signal?.throwIfAborted();
        request.beforeSend?.();
      }
      starts.push(clock.now());
    }
    sent += 1;
  };

  return {
    id: inner.id,
    complete: async (request: ProviderRequest): Promise<ProviderResponse> => {
      request.signal?.throwIfAborted();
      request.beforeSend?.();
      const slot = queue.then(() => acquire(request));
      queue = slot.catch(() => undefined);
      await slot;
      request.signal?.throwIfAborted();
      request.beforeSend?.();
      return inner.complete(request);
    },
    isRetryable: (error) =>
      !(error instanceof RequestQuotaError) && inner.isRetryable(error),
    errorInfo: (error) =>
      error instanceof RequestQuotaError
        ? { fatal: true }
        : (inner.errorInfo?.(error) ?? {}),
    ...(inner.describe === undefined
      ? {}
      : { describe: inner.describe.bind(inner) }),
    ...(inner.countTokens === undefined
      ? {}
      : { countTokens: inner.countTokens.bind(inner) }),
  };
};
