import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

import type { Symbol as DocumentationSymbol } from "../src/core/symbol.js";
import {
  LlmClient,
  type LlmProvider,
  type ProviderRequest,
  type ProviderResponse,
} from "../src/llm/client.js";
import { AnthropicProvider } from "../src/llm/providers/anthropic.js";
import {
  GENERATION_PROMPT_VERSION,
  generationPrompt,
  generationSystemPrompt,
} from "../src/llm/prompt/v1.js";
import { parseGenerationResponse } from "../src/llm/schema.js";

describe("LLM generation", () => {
  it("limits concurrency, retries transient failures, and totals usage", async () => {
    let active = 0;
    let maximumActive = 0;
    let transientFailures = 0;
    const sleep = vi.fn(() => Promise.resolve());
    const provider: LlmProvider = {
      id: "stub",
      isRetryable: () => true,
      complete: async (request) => {
        if (transientFailures++ === 0) throw new Error("rate limited");
        active++;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active--;
        return response(okPayload(idFromPrompt(request.prompt)), 3, 2, 0.01);
      },
    };
    const client = new LlmClient(provider, {
      concurrency: 2,
      retryCount: 1,
      sleep,
    });

    const result = await client.generate(
      [symbol("a"), symbol("b"), symbol("c")].map((item) => ({
        symbol: item,
        model: "stub-model",
        system: generationSystemPrompt,
        prompt: generationPrompt(item, "context"),
      })),
    );

    expect(maximumActive).toBeLessThanOrEqual(2);
    expect(result.results[0]?.attempts).toBe(2);
    expect(sleep).toHaveBeenCalledWith(250);
    expect(result.usage).toEqual({
      inputTokens: 9,
      outputTokens: 6,
      costUsd: 0.03,
    });
  });

  it("retries one invalid response, then accepts strict plain-text JSON", async () => {
    const item = symbol("strict", ["value"]);
    const complete = vi
      .fn<(request: ProviderRequest) => Promise<ProviderResponse>>()
      .mockResolvedValueOnce(response({ verdict: "OK" }))
      .mockResolvedValueOnce(
        response(okPayload(item.id, { value: "Value to convert." })),
      );
    const client = new LlmClient(
      { id: "stub", complete, isRetryable: () => false },
      { concurrency: 1 },
    );

    const result = await client.generate([
      {
        symbol: item,
        model: "stub-model",
        system: generationSystemPrompt,
        prompt: generationPrompt(item, "context"),
      },
    ]);

    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]?.[0].prompt).toContain(
      "previous response was invalid",
    );
    expect(result.results[0]).toMatchObject({
      attempts: 2,
      outcome: { verdict: "OK", id: item.id },
    });
  });

  it("drops a response after the validation retry fails", async () => {
    const item = symbol("invalid");
    const provider: LlmProvider = {
      id: "stub",
      isRetryable: () => false,
      complete: () => Promise.resolve(response({ verdict: "OK" })),
    };
    const result = await new LlmClient(provider, { concurrency: 1 }).generate([
      {
        symbol: item,
        model: "stub-model",
        system: generationSystemPrompt,
        prompt: generationPrompt(item, "context"),
      },
    ]);

    expect(result.results[0]).toMatchObject({ attempts: 2 });
    expect(result.results[0]?.outcome).toBeUndefined();
    expect(result.results[0]?.error).toBeTruthy();
  });

  it("treats SKIP as a valid outcome", () => {
    const item = symbol("skip");
    expect(
      parseGenerationResponse(
        {
          id: item.id,
          summary: null,
          detail: null,
          params: {},
          returns: null,
          throws: [],
          verdict: "SKIP",
          reason: "No behavior beyond the signature.",
        },
        item,
      ),
    ).toEqual({
      verdict: "SKIP",
      id: item.id,
      reason: "No behavior beyond the signature.",
    });
  });

  it("keeps prompts versioned and requires semantic JSON without markup", () => {
    const item = symbol("prompt", ["value"]);
    const prompt = generationPrompt(item, "assembled context");

    expect(GENERATION_PROMPT_VERSION).toBe("1");
    expect(generationSystemPrompt).toContain("plain text");
    expect(prompt).toContain(
      'params must contain exactly these keys: ["value"]',
    );
    expect(prompt).toContain("assembled context");
    expect(() =>
      parseGenerationResponse(
        okPayload(item.id, { value: "@param value Invalid markup." }),
        item,
      ),
    ).toThrow(/markup/u);
  });

  it("uses Anthropic structured output and accounts for token cost", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        { type: "text", text: JSON.stringify(okPayload("src/a.ts#a")) },
      ],
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_creation_input_tokens: 5,
        cache_read_input_tokens: 10,
      },
    });
    const provider = new AnthropicProvider({
      client: { messages: { create } } as unknown as Anthropic,
    });
    const request: ProviderRequest = {
      model: "claude-sonnet-5",
      system: "system",
      prompt: "prompt",
      responseSchema: { type: "object" },
    };

    const result = await provider.complete(request);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        output_config: {
          format: { type: "json_schema", schema: request.responseSchema },
        },
      }),
    );
    expect(result.usage).toEqual({
      inputTokens: 115,
      outputTokens: 20,
      costUsd: 0.0004145,
    });
  });
});

const response = (
  value: unknown,
  inputTokens = 0,
  outputTokens = 0,
  costUsd = 0,
): ProviderResponse => ({
  value,
  usage: { inputTokens, outputTokens, costUsd },
});

const okPayload = (
  id: string,
  params: Readonly<Record<string, string>> = {},
) => ({
  id,
  summary: `Documents ${id}.`,
  detail: null,
  params,
  returns: null,
  throws: [],
  verdict: "OK",
  reason: null,
});

const symbol = (
  name: string,
  parameters: readonly string[] = [],
): DocumentationSymbol => ({
  id: `src/a.ts#${name}`,
  name,
  kind: "function",
  filePath: "src/a.ts",
  signature: `function ${name}(): void`,
  body: "return;",
  parameters: parameters.map((parameter) => ({
    name: parameter,
    text: `${parameter}: string`,
    optional: false,
    rest: false,
  })),
  asynchronous: false,
  exported: true,
  visibility: "public",
  declaration: {
    start: 0,
    end: 20,
    startLine: 1,
    startColumn: 1,
    endLine: 1,
    endColumn: 21,
  },
  existingDoc: null,
  sourceNote: null,
});

const idFromPrompt = (prompt: string): string => {
  const match = prompt.match(/id must be exactly ("[^"]+")/u);
  if (match?.[1] === undefined) throw new Error("Missing id in prompt");
  return JSON.parse(match[1]) as string;
};
