import { describe, expect, it, vi } from "vitest";

import type { Symbol as DocumentationSymbol } from "../src/core/symbol.js";
import type {
  LlmProvider,
  ProviderRequest,
  ProviderResponse,
} from "../src/llm/client.js";
import { JudgeClient } from "../src/llm/judge.js";
import { judgePrompt } from "../src/llm/prompt/index.js";

describe("documentation judge", () => {
  it("accepts useful documentation and exposes strict leaf mode", async () => {
    const item = symbol();
    const complete = vi.fn<
      (request: ProviderRequest) => Promise<ProviderResponse>
    >(() =>
      Promise.resolve(
        response({
          id: item.id,
          verdict: "ACCEPT",
          reason: "States the zero-value fallback.",
        }),
      ),
    );
    const client = new JudgeClient(provider(complete), { concurrency: 1 });

    const result = await client.judge([
      {
        symbol: item,
        doc: doc(),
        context: "Returns zero when no values are supplied.",
        model: "judge-model",
        strict: true,
      },
    ]);

    expect(result.results[0]).toMatchObject({
      accepted: true,
      reason: "States the zero-value fallback.",
    });
    expect(complete.mock.calls[0]?.[0].prompt).toContain(
      "strict mode is enabled",
    );
  });

  it("reports rejection reasons", async () => {
    const item = symbol();
    const client = new JudgeClient(
      provider(() =>
        Promise.resolve(
          response({
            id: item.id,
            verdict: "REJECT",
            reason: "Only paraphrases the return type.",
          }),
        ),
      ),
      { concurrency: 1 },
    );

    await expect(
      client.judge([
        {
          symbol: item,
          doc: doc(),
          context: "context",
          model: "judge-model",
          strict: false,
        },
      ]),
    ).resolves.toMatchObject({
      results: [
        {
          accepted: false,
          reason: "Only paraphrases the return type.",
        },
      ],
    });
  });

  it("retries invalid output once and fails closed", async () => {
    const complete = vi
      .fn<() => Promise<ProviderResponse>>()
      .mockResolvedValue(response({ verdict: "ACCEPT" }));
    const client = new JudgeClient(provider(complete), { concurrency: 1 });

    const result = await client.judge([
      {
        symbol: symbol(),
        doc: doc(),
        context: "context",
        model: "judge-model",
        strict: false,
      },
    ]);

    expect(complete).toHaveBeenCalledTimes(2);
    expect(result.results[0]).toMatchObject({
      accepted: false,
      attempts: 2,
    });
    expect(typeof result.results[0]?.error).toBe("string");
  });

  it("retries transient provider failures", async () => {
    const item = symbol();
    const sleep = vi.fn(() => Promise.resolve());
    const complete = vi
      .fn<(request: ProviderRequest) => Promise<ProviderResponse>>()
      .mockRejectedValueOnce(new Error("rate limited"))
      .mockResolvedValue(
        response({
          id: item.id,
          verdict: "ACCEPT",
          reason: "Adds a supported edge case.",
        }),
      );
    const client = new JudgeClient(
      { id: "stub", complete, isRetryable: () => true },
      { concurrency: 1, retryCount: 1, sleep },
    );

    const result = await client.judge([
      {
        symbol: item,
        doc: doc(),
        context: "context",
        model: "judge-model",
        strict: false,
      },
    ]);

    expect(result.results[0]).toMatchObject({ accepted: true, attempts: 2 });
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it("asks whether documentation adds information beyond the signature", () => {
    const prompt = judgePrompt(symbol(), doc(), "behavioral context", false);
    expect(prompt).toContain("not already evident from the signature");
    expect(prompt).toContain("behavioral context");
    expect(prompt).toContain('"summary": "Returns zero for empty input."');
  });
});

const provider = (
  complete: (request: ProviderRequest) => Promise<ProviderResponse>,
): LlmProvider => ({ id: "stub", complete, isRetryable: () => false });

const response = (value: unknown): ProviderResponse => ({
  value,
  usage: { inputTokens: 3, outputTokens: 2, costUsd: 0.001 },
});

const doc = () => ({
  summary: "Returns zero for empty input.",
  params: {},
  returns: "The sum, or zero for empty input.",
  throws: [],
});

const symbol = (): DocumentationSymbol => ({
  id: "src/math.ts#sum",
  name: "sum",
  kind: "function",
  filePath: "src/math.ts",
  signature: "function sum(values: number[]): number",
  body: "return values.reduce((total, value) => total + value, 0);",
  parameters: [],
  returnsValue: true,
  asynchronous: false,
  exported: true,
  visibility: "public",
  declaration: {
    start: 0,
    end: 10,
    startLine: 1,
    startColumn: 1,
    endLine: 1,
    endColumn: 11,
  },
  existingDoc: null,
  sourceNote: null,
});
