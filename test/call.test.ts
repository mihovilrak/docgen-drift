import { describe, expect, it } from "vitest";

import { MAX_RETRY_WAIT_MS, ProviderCaller } from "../src/llm/call.js";
import type {
  LlmProvider,
  ProviderRequest,
  ProviderResponse,
} from "../src/llm/client.js";
import { pacedProvider } from "../src/llm/pacing.js";
import {
  HttpProviderError,
  httpErrorInfo,
  isRetryableHttpError,
  parseRetryAfterMs,
} from "../src/llm/providers/http.js";

const request: ProviderRequest = {
  model: "m",
  system: "s",
  prompt: "p",
  responseSchema: { type: "object" },
};

const ok: ProviderResponse = {
  value: {},
  usage: { inputTokens: 1, outputTokens: 1, costBasis: "none" },
};

const httpProvider = (
  complete: () => Promise<typeof ok>,
): LlmProvider & { calls: () => number } => {
  let calls = 0;
  return {
    id: "stub",
    complete: () => {
      calls += 1;
      return complete();
    },
    isRetryable: isRetryableHttpError,
    errorInfo: httpErrorInfo,
    calls: () => calls,
  };
};

const caller = (provider: LlmProvider, waits: number[] = []): ProviderCaller =>
  new ProviderCaller(provider, {
    retryCount: 2,
    baseDelayMs: 10,
    sleep: (milliseconds) => {
      waits.push(milliseconds);
      return Promise.resolve();
    },
  });

describe("provider calls", () => {
  it("parses Retry-After seconds, dates, and Google retryDelay", () => {
    expect(parseRetryAfterMs("7")).toBe(7000);
    expect(
      parseRetryAfterMs(
        "Thu, 01 Jan 2026 00:00:30 GMT",
        "",
        Date.UTC(2026, 0, 1),
      ),
    ).toBe(30_000);
    expect(parseRetryAfterMs(null, '{"retryDelay": "12.5s"}')).toBe(12_500);
    expect(parseRetryAfterMs(null, "no hint")).toBeUndefined();
  });

  it("waits for the server's Retry-After before retrying", async () => {
    let first = true;
    const provider = httpProvider(() => {
      if (!first) return Promise.resolve(ok);
      first = false;
      return Promise.reject(new HttpProviderError("busy", 429, false, 3000));
    });
    const waits: number[] = [];

    await expect(
      caller(provider, waits).complete(request),
    ).resolves.toMatchObject({
      attempts: 2,
    });
    expect(waits).toEqual([3000]);
  });

  it("fails and halts when the server asks for a wait beyond the cap", async () => {
    const provider = httpProvider(() =>
      Promise.reject(
        new HttpProviderError("quota", 429, false, MAX_RETRY_WAIT_MS + 1000),
      ),
    );
    const subject = caller(provider);

    await expect(subject.complete(request)).rejects.toThrow(
      "quota (provider asked to wait 61s)",
    );
    await expect(subject.complete(request)).rejects.toThrow(
      /^Not sent after an earlier provider error: quota/u,
    );
    expect(provider.calls()).toBe(1);
  });

  it.each([401, 404])("halts the batch after a %i", async (status) => {
    const provider = httpProvider(() =>
      Promise.reject(
        new HttpProviderError(`stub returned ${String(status)}`, status),
      ),
    );
    const subject = caller(provider);

    await expect(subject.complete(request)).rejects.toThrow(
      `stub returned ${String(status)}`,
    );
    await expect(subject.complete(request)).rejects.toThrow(/^Not sent/u);
    expect(provider.calls()).toBe(1);
  });

  it("halts after consecutive 400s but not after one", async () => {
    const provider = httpProvider(() =>
      Promise.reject(new HttpProviderError("bad request", 400)),
    );
    const subject = caller(provider);

    for (let index = 0; index < 3; index++) {
      await expect(subject.complete(request)).rejects.toThrow("bad request");
    }
    await expect(subject.complete(request)).rejects.toThrow(/^Not sent/u);
    expect(provider.calls()).toBe(3);
  });
});

describe("request pacing", () => {
  const clock = () => {
    let now = 0;
    const waits: number[] = [];
    return {
      waits,
      now: () => now,
      sleep: (milliseconds: number) => {
        waits.push(milliseconds);
        now += milliseconds;
        return Promise.resolve();
      },
    };
  };

  it("spaces request starts to the per-minute limit", async () => {
    const time = clock();
    const provider = pacedProvider(
      httpProvider(() => Promise.resolve(ok)),
      { requestsPerMinute: 2 },
      time,
    );

    await Promise.all([1, 2, 3].map(() => provider.complete(request)));

    expect(time.waits).toEqual([60_000]);
  });

  it("stops the run at the per-day limit", async () => {
    const inner = httpProvider(() => Promise.resolve(ok));
    const subject = caller(
      pacedProvider(inner, { requestsPerDay: 1 }, clock()),
    );

    await subject.complete(request);
    await expect(subject.complete(request)).rejects.toThrow(
      "stub reached requestsPerDay (1) for this run",
    );
    await expect(subject.complete(request)).rejects.toThrow(/^Not sent/u);
    expect(inner.calls()).toBe(1);
  });
});
