import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";

import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

import type { Symbol as DocumentationSymbol } from "../src/core/symbol.js";
import { LlmClient, type LlmProvider } from "../src/llm/client.js";
import { JudgeClient } from "../src/llm/judge.js";
import { AnthropicProvider } from "../src/llm/providers/anthropic.js";
import {
  CliTransportError,
  CliTransportProvider,
  type CliRunner,
  type CliTool,
} from "../src/llm/providers/cliTransport.js";
import { GoogleProvider } from "../src/llm/providers/google.js";
import { createOpenAiProvider } from "../src/llm/providers/openai.js";
import { OpenAiCompatibleProvider } from "../src/llm/providers/openaiCompatible.js";
import {
  generationPrompt,
  generationSystemPrompt,
} from "../src/llm/prompt/index.js";

interface Harness {
  readonly name: string;
  readonly usageBasis: "usd" | "unknown" | "subscription";
  create(responses: readonly unknown[]): LlmProvider;
}

const httpHarness = (
  name: string,
  usageBasis: Harness["usageBasis"],
  construct: (fetchImpl: typeof fetch) => LlmProvider,
): Harness => ({
  name,
  usageBasis,
  create: (responses) => {
    const queue = [...responses];
    return construct(() => Promise.resolve(openAiResponse(queue.shift())));
  },
});

const harnesses: readonly Harness[] = [
  {
    name: "anthropic",
    usageBasis: "usd",
    create: (responses) => {
      const queue = [...responses];
      const create = vi.fn(() =>
        Promise.resolve({
          content: [{ type: "text", text: JSON.stringify(queue.shift()) }],
          usage: { input_tokens: 7, output_tokens: 3 },
        }),
      );
      return new AnthropicProvider({
        client: { messages: { create } } as unknown as Anthropic,
      });
    },
  },
  httpHarness("openai", "usd", (fetchImpl) =>
    createOpenAiProvider({ apiKey: "test", fetchImpl }),
  ),
  httpHarness(
    "openai-compatible",
    "unknown",
    (fetchImpl) =>
      new OpenAiCompatibleProvider({
        id: "openai-compatible",
        baseUrl: "http://local.test/v1",
        fetchImpl,
      }),
  ),
  {
    name: "google",
    usageBasis: "usd",
    create: (responses) => {
      const queue = [...responses];
      return new GoogleProvider({
        apiKey: "test",
        fetchImpl: () =>
          Promise.resolve(
            jsonResponse({
              candidates: [
                {
                  content: {
                    parts: [{ text: JSON.stringify(queue.shift()) }],
                  },
                },
              ],
              usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 },
            }),
          ),
      });
    },
  },
  ...(["claude", "codex", "gemini", "opencode", "pi"] as const).map(
    (tool): Harness => ({
      name: `cli:${tool}`,
      usageBasis: "subscription",
      create: (responses) => cliProvider(tool, responses),
    }),
  ),
];

describe.each(harnesses)("provider conformance: $name", (harness) => {
  it("generates semantic JSON and accounts for usage", async () => {
    const item = symbol();
    const result = await generate(harness.create([ok(item.id)]), item);

    expect(result.results[0]?.outcome).toMatchObject({
      verdict: "OK",
      id: item.id,
    });
    expect(result.usage.costBasis).toBe(harness.usageBasis);
  });

  it("preserves SKIP as a first-class outcome", async () => {
    const item = symbol();
    const result = await generate(harness.create([skip(item.id)]), item);

    expect(result.results[0]?.outcome).toEqual({
      verdict: "SKIP",
      id: item.id,
      reason: "No behavior beyond the signature.",
    });
  });

  it("runs the judge contract", async () => {
    const item = symbol();
    const result = await new JudgeClient(
      harness.create([
        { id: item.id, verdict: "ACCEPT", reason: "Adds an edge case." },
      ]),
      { concurrency: 1 },
    ).judge([
      {
        symbol: item,
        doc: {
          summary: "Returns zero for empty input.",
          params: {},
          returns: "The sum, or zero when no values are supplied.",
          throws: [],
        },
        context: "Returns zero for empty input.",
        model: modelFor(harness.name),
        strict: true,
      },
    ]);

    expect(result.results[0]).toMatchObject({ accepted: true, attempts: 1 });
  });

  it("fails closed after two schema-invalid responses", async () => {
    const item = symbol();
    const result = await generate(
      harness.create([{ verdict: "OK" }, { verdict: "OK" }]),
      item,
    );

    expect(result.results[0]?.outcome).toBeUndefined();
    expect(result.results[0]).toMatchObject({ attempts: 2 });
    expect(result.results[0]?.error).toBeTruthy();
  });
});

describe("provider failures", () => {
  it("uses the compatible token-limit field for local and direct OpenAI", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl: typeof fetch = (_input, init) => {
      bodies.push(requestBody(init));
      return Promise.resolve(openAiResponse(ok(symbol().id)));
    };
    await new OpenAiCompatibleProvider({
      id: "local",
      baseUrl: "http://local.test/v1",
      fetchImpl,
    }).complete({
      model: "local",
      system: "system",
      prompt: "prompt",
      responseSchema: { type: "object" },
    });
    await createOpenAiProvider({ apiKey: "test", fetchImpl }).complete({
      model: "gpt-5",
      system: "system",
      prompt: "prompt",
      responseSchema: { type: "object" },
    });

    expect(bodies[0]).toMatchObject({ max_tokens: 1200 });
    expect(bodies[0]).not.toHaveProperty("max_completion_tokens");
    expect(bodies[1]).toMatchObject({ max_completion_tokens: 1200 });
  });

  it("sends Google only JSON Schema keywords its API supports", async () => {
    let body: Record<string, unknown> | undefined;
    const provider = new GoogleProvider({
      apiKey: "test",
      fetchImpl: (_input, init) => {
        body = requestBody(init);
        return Promise.resolve(
          jsonResponse({
            candidates: [{ content: { parts: [{ text: "{}" }] } }],
          }),
        );
      },
    });

    await provider.complete({
      model: "gemini-2.5-flash",
      system: "system",
      prompt: "prompt",
      responseSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        propertyNames: { type: "string" },
        properties: { id: { type: "string", minLength: 1 } },
      },
    });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("$schema");
    expect(serialized).not.toContain("propertyNames");
    expect(serialized).not.toContain("minLength");
  });

  it("retries a transient HTTP response and totals only completed usage", async () => {
    const item = symbol();
    let calls = 0;
    const provider = createOpenAiProvider({
      apiKey: "test",
      fetchImpl: () => {
        calls++;
        return Promise.resolve(
          calls === 1
            ? new Response("rate limited", { status: 429 })
            : openAiResponse(ok(item.id)),
        );
      },
    });
    const result = await new LlmClient(provider, {
      concurrency: 1,
      retryCount: 1,
      sleep: () => Promise.resolve(),
    }).generate([request(item, "gpt-5")]);

    expect(calls).toBe(2);
    expect(result.results[0]).toMatchObject({ attempts: 2 });
    expect(result.usage).toMatchObject({ inputTokens: 7, outputTokens: 3 });
  });

  it("bounds HTTP requests with a timeout", async () => {
    const item = symbol();
    const provider = new OpenAiCompatibleProvider({
      id: "local",
      baseUrl: "http://local.test/v1",
      timeoutMs: 5,
      fetchImpl: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(
              init.signal?.reason instanceof Error
                ? init.signal.reason
                : new Error("request aborted"),
            );
          });
        }),
    });
    const result = await new LlmClient(provider, {
      concurrency: 1,
      retryCount: 0,
    }).generate([request(item, "local")]);

    expect(result.results[0]?.error).toMatch(/request failed/u);
    expect(result.results[0]?.attempts).toBe(1);
  });

  it("does not retry a cancelled request as a schema failure", async () => {
    const item = symbol();
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const complete = vi.fn();
    const result = await new LlmClient(
      { id: "stub", complete, isRetryable: () => true },
      { concurrency: 1, signal: controller.signal },
    ).generate([request(item, "stub")]);

    expect(complete).not.toHaveBeenCalled();
    expect(result.results[0]).toMatchObject({
      attempts: 1,
      error: "cancelled",
    });
  });

  it("passes a local server's 400 through verbatim", async () => {
    const provider = new OpenAiCompatibleProvider({
      id: "local",
      baseUrl: "http://local.test/v1",
      fetchImpl: () =>
        Promise.resolve(
          new Response("response_format json_schema is unsupported", {
            status: 400,
          }),
        ),
    });

    await expect(
      provider.complete({
        model: "local",
        system: "system",
        prompt: "prompt",
        responseSchema: { type: "object" },
      }),
    ).rejects.toThrow(
      "local returned 400: response_format json_schema is unsupported",
    );
  });

  it("classifies CLI timeouts as retryable", async () => {
    const provider = new CliTransportProvider({
      tool: "pi",
      timeoutMs: 10,
      run: () =>
        Promise.resolve({
          code: null,
          stdout: "",
          stderr: "",
          timedOut: true,
        }),
    });

    await expect(
      provider.complete({
        model: "test-model",
        system: "system",
        prompt: "prompt",
        responseSchema: { type: "object" },
      }),
    ).rejects.toMatchObject({ retryable: true });
  });

  it("classifies Claude tool-use turn exits without exposing raw usage in the message", async () => {
    const diagnostic = JSON.stringify({
      stop_reason: "tool_use",
      usage: { input_tokens: 99_999, output_tokens: 1 },
    });
    const provider = new CliTransportProvider({
      tool: "claude",
      run: () =>
        Promise.resolve({
          code: 1,
          stdout: diagnostic,
          stderr: "",
        }),
    });

    const error = await provider
      .complete({
        model: "sonnet",
        system: "system",
        prompt: "prompt",
        responseSchema: { type: "object" },
      })
      .catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(CliTransportError);
    expect(error).toMatchObject({
      message:
        "claude reached its structured-output turn limit before returning validated JSON",
      retryable: false,
      diagnostic,
    });
    expect((error as Error).message).not.toContain("input_tokens");
  });

  it("sends agent CLIs no project context and no redundant prompt text", async () => {
    let seen:
      | {
          readonly args: readonly string[];
          readonly input: string;
          readonly cwd: string | undefined;
          readonly entries: readonly string[];
        }
      | undefined;
    const run: CliRunner = async (_command, args, input, options) => {
      seen = {
        args,
        input,
        cwd: options.cwd,
        entries: options.cwd === undefined ? [] : await readdir(options.cwd),
      };
      return {
        code: 0,
        stdout: JSON.stringify({
          result: JSON.stringify({
            id: "src/a.ts#a",
            verdict: "SKIP",
            reason: "none",
          }),
        }),
        stderr: "",
      };
    };

    await new CliTransportProvider({ tool: "claude", run }).complete({
      model: "sonnet",
      system: "SYSTEM PROMPT",
      prompt: "prompt",
      responseSchema: { type: "object", properties: { marker: {} } },
    });

    const args = seen?.args ?? [];
    expect(args[args.indexOf("--system-prompt") + 1]).toBe("SYSTEM PROMPT");
    expect(args).toContain("--exclude-dynamic-system-prompt-sections");
    expect(args).toContain("--strict-mcp-config");
    // The harness preamble, project memory files and the schema are all sent by
    // argv or suppressed, so none of them may appear in the prompt as well.
    expect(seen?.input).not.toContain("SYSTEM PROMPT");
    expect(seen?.input).not.toContain("marker");
    expect(seen?.cwd?.startsWith(tmpdir())).toBe(true);
    expect(seen?.entries).toEqual([]);
  });

  it("inlines the response schema only for tools without a schema flag", async () => {
    const inputs = new Map<CliTool, string>();
    const run: CliRunner = (_command, _args, input) => {
      inputs.set(tool, input);
      return Promise.resolve({
        code: 0,
        stdout: JSON.stringify({
          sessionID: "ses_docgen",
          session_id: "gemini-docgen",
          result: JSON.stringify({
            id: "src/a.ts#a",
            verdict: "SKIP",
            reason: "none",
          }),
        }),
        stderr: "",
      });
    };
    let tool: CliTool = "claude";

    for (const candidate of ["claude", "codex", "pi"] as const) {
      tool = candidate;
      await new CliTransportProvider({ tool: candidate, run }).complete({
        model: "test-model",
        system: "system",
        prompt: "prompt",
        responseSchema: { type: "object", properties: { marker: {} } },
      });
    }

    expect(inputs.get("claude")).not.toContain("marker");
    expect(inputs.get("codex")).not.toContain("marker");
    expect(inputs.get("pi")).toContain("marker");
    expect(inputs.get("codex")).toContain("system");
  });

  it("keeps malformed CLI output in diagnostics instead of the public error", async () => {
    const provider = new CliTransportProvider({
      tool: "pi",
      run: () =>
        Promise.resolve({
          code: 0,
          stdout: "raw provider output with private usage details",
          stderr: "",
        }),
    });

    const error = await provider
      .complete({
        model: "test-model",
        system: "system",
        prompt: "prompt",
        responseSchema: { type: "object" },
      })
      .catch((failure: unknown) => failure);

    expect(error).toMatchObject({
      message: "pi returned output that did not contain semantic JSON",
      diagnostic: "raw provider output with private usage details",
    });
    expect((error as Error).message).not.toContain("private usage details");
  });
});

const cliProvider = (
  tool: CliTool,
  responses: readonly unknown[],
): LlmProvider => {
  const queue = [...responses];
  const run: CliRunner = (_command, args, _input, options) => {
    if (args.includes("delete") || args.includes("--delete-session")) {
      expect(args).toContain(
        tool === "gemini" ? "gemini-docgen" : "ses_docgen",
      );
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    }
    expect(args).toContain("--model");
    if (tool === "claude") {
      expect(args).toContain("--json-schema");
      expect(args).toContain("--no-session-persistence");
      expect(args[args.indexOf("--max-turns") + 1]).toBe("3");
    }
    if (tool === "codex") {
      expect(args).toContain("--ephemeral");
      expect(args).toContain("--output-schema");
    }
    if (tool === "gemini") {
      expect(args).toContain("stream-json");
      expect(args).toContain("--admin-policy");
    }
    if (tool === "pi") {
      expect(args).toContain("--no-tools");
      expect(args).toContain("--no-session");
    }
    if (tool === "opencode") {
      expect(options.env?.["OPENCODE_PERMISSION"]).toContain("deny");
    }
    const value = JSON.stringify(queue.shift());
    const stdout =
      tool === "codex"
        ? `${JSON.stringify({ type: "item.completed", item: { text: value } })}\n`
        : tool === "gemini"
          ? `${JSON.stringify({ type: "init", session_id: "gemini-docgen" })}\n${JSON.stringify({ type: "message", content: value })}\n`
          : JSON.stringify({
              ...(tool === "opencode" ? { sessionID: "ses_docgen" } : {}),
              result: value,
            });
    return Promise.resolve({ code: 0, stdout, stderr: "" });
  };
  return new CliTransportProvider({ tool, run });
};

const generate = (provider: LlmProvider, item: DocumentationSymbol) =>
  new LlmClient(provider, { concurrency: 1 }).generate([
    request(item, modelFor(provider.id)),
  ]);

const request = (item: DocumentationSymbol, model: string) => ({
  symbol: item,
  model,
  system: generationSystemPrompt,
  prompt: generationPrompt(item, "Returns zero for empty input."),
});

const modelFor = (provider: string): string =>
  provider === "anthropic"
    ? "claude-sonnet-5"
    : provider === "openai"
      ? "gpt-5"
      : provider === "google"
        ? "gemini-2.5-flash"
        : "test-model";

const openAiResponse = (value: unknown): Response =>
  jsonResponse({
    model: "gpt-5",
    choices: [{ message: { content: JSON.stringify(value) } }],
    usage: { prompt_tokens: 7, completion_tokens: 3 },
  });

const jsonResponse = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const requestBody = (
  init: RequestInit | undefined,
): Record<string, unknown> => {
  if (typeof init?.body !== "string") throw new Error("Expected JSON body");
  return JSON.parse(init.body) as Record<string, unknown>;
};

const ok = (id: string) => ({
  id,
  summary: "Returns zero for empty input.",
  detail: null,
  params: {},
  returns: "The sum, or zero when no values are supplied.",
  throws: [],
  verdict: "OK" as const,
  reason: null,
});

const skip = (id: string) => ({
  id,
  summary: null,
  detail: null,
  params: {},
  returns: null,
  throws: [],
  verdict: "SKIP" as const,
  reason: "No behavior beyond the signature.",
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
