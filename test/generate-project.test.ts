import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { extractSymbols } from "../src/adapters/typescript/extract/index.js";
import { loadProject } from "../src/adapters/typescript/loadProject.js";
import {
  generateProject,
  generationRuntime,
} from "../src/cli/generateProject.js";
import { configSchema } from "../src/config/schema.js";
import type { GeneratedDoc } from "../src/core/symbol.js";
import type { LlmProvider, ProviderRequest } from "../src/llm/client.js";

const fixtureRoot = resolve("test/fixtures/graph");

describe("project generation", () => {
  it("stops later generation levels and projects after a fatal judge failure", async () => {
    const project = await loadProject({ tsconfigPath: fixtureRoot });
    const symbols = extractSymbols(project);
    const targets = new Set([
      symbolId(symbols, "leaf"),
      symbolId(symbols, "orchestrate"),
    ]);
    const generation = recordingProvider();
    let judgeCalls = 0;
    const providers = {
      generation,
      judge: {
        id: "judge",
        complete: () => {
          judgeCalls++;
          return Promise.reject(new Error("invalid judge credential"));
        },
        isRetryable: () => false,
        errorInfo: () => ({ fatal: true }),
      },
      runtime: generationRuntime(1),
    };
    const config = configSchema.parse({
      symbols: { minBodyLines: 0 },
      context: { sources: { gitSubject: false } },
      generate: { concurrency: 1 },
    });
    const first = await generateProject(
      project,
      targets,
      config,
      providers,
      false,
    );
    expect(first.failed).toHaveLength(2);
    expect(generation.requests).toHaveLength(1);
    expect(judgeCalls).toBe(1);
    const second = await generateProject(
      project,
      targets,
      config,
      providers,
      false,
    );
    expect(second.failed).toHaveLength(2);
    expect(generation.requests).toHaveLength(1);
    expect(judgeCalls).toBe(1);
  });
  it("generates by dependency level and feeds callee summaries to callers", async () => {
    const project = await loadProject({ tsconfigPath: fixtureRoot });
    const symbols = extractSymbols(project);
    const targets = new Set(
      ["leaf", "mutualA", "mutualB", "orchestrate"].map((name) =>
        symbolId(symbols, name),
      ),
    );
    const provider = recordingProvider();

    const first = await generateProject(
      project,
      targets,
      configSchema.parse({ symbols: { minBodyLines: 0 } }),
      { generation: provider },
      false,
    );

    expect(first.generated).toHaveLength(4);
    expect(first.rejected).toEqual([]);
    const orchestratePrompt = provider.requests.find((request) =>
      request.prompt.includes("#orchestrate"),
    )?.prompt;
    expect(orchestratePrompt).toContain(
      `CALLEE SUMMARY: ${symbolId(symbols, "leaf")} - Generated leaf behavior.`,
    );
    expect(orchestratePrompt).toContain(
      `CALLEE SUMMARY: ${symbolId(symbols, "mutualA")} - Generated mutualA behavior.`,
    );

    const second = await generateProject(
      project,
      targets,
      configSchema.parse({ symbols: { minBodyLines: 0 } }),
      { generation: recordingProvider() },
      false,
    );
    expect(second.edits.files).toEqual(first.edits.files);
  });

  it("reports SKIP without rendering or propagating it", async () => {
    const project = await loadProject({ tsconfigPath: fixtureRoot });
    const symbols = extractSymbols(project);
    const leaf = symbolId(symbols, "leaf");
    const orchestrate = symbolId(symbols, "orchestrate");
    const provider = recordingProvider(new Set([leaf]));

    const result = await generateProject(
      project,
      new Set([leaf, orchestrate]),
      configSchema.parse({ symbols: { minBodyLines: 0 } }),
      { generation: provider },
      false,
    );

    expect(result.skipped).toEqual([
      { id: leaf, reason: "Insufficient behavioral context." },
    ]);
    expect(result.generated).toEqual([orchestrate]);
    expect(
      provider.requests.find((request) =>
        request.prompt.includes("#orchestrate"),
      )?.prompt,
    ).not.toContain(`CALLEE SUMMARY: ${leaf}`);
  });

  it("judges leaves strictly and does not propagate rejected summaries", async () => {
    const project = await loadProject({ tsconfigPath: fixtureRoot });
    const symbols = extractSymbols(project);
    const leaf = symbolId(symbols, "leaf");
    const orchestrate = symbolId(symbols, "orchestrate");
    const provider = recordingProvider(new Set(), new Set([leaf]));

    const result = await generateProject(
      project,
      new Set([leaf, orchestrate]),
      configSchema.parse({ symbols: { minBodyLines: 0 } }),
      { generation: provider },
      false,
    );

    expect(result.rejected).toEqual([
      { id: leaf, reason: "Only restates the signature." },
    ]);
    expect(result.generated).toEqual([orchestrate]);
    const leafJudge = provider.requests.find(
      (request) =>
        request.prompt.includes(`documentation for ${leaf}`) &&
        request.prompt.includes("strict mode"),
    );
    expect(leafJudge?.prompt).toContain("strict mode is enabled");
    expect(
      provider.requests.find((request) =>
        request.prompt.includes("Document src/service.ts#orchestrate"),
      )?.prompt,
    ).not.toContain(`CALLEE SUMMARY: ${leaf}`);
  });

  it("sends one identical module outline as the prefix for every request", async () => {
    const project = await loadProject({ tsconfigPath: fixtureRoot });
    const symbols = extractSymbols(project);
    const provider = recordingProvider();

    await generateProject(
      project,
      new Set(
        ["leaf", "mutualA", "mutualB", "orchestrate"].map((name) =>
          symbolId(symbols, name),
        ),
      ),
      configSchema.parse({ symbols: { minBodyLines: 0 } }),
      { generation: provider },
      false,
    );

    const prefixes = new Set(
      provider.requests.map((request) => request.prefix),
    );
    expect(prefixes.size).toBe(1);
    const prefix = [...prefixes][0];
    expect(prefix).toContain("MODULE: src/service.ts");
    expect(prefix).toContain("- function orchestrate(input: PaymentInput)");
    expect(
      provider.requests.filter((request) => request.prompt.includes("Judge"))
        .length,
    ).toBeGreaterThan(0);
  });

  it("omits the outline when a file has a single documented symbol", async () => {
    const project = await loadProject({ tsconfigPath: fixtureRoot });
    const symbols = extractSymbols(project);
    const provider = recordingProvider();

    await generateProject(
      project,
      new Set([symbolId(symbols, "leaf")]),
      configSchema.parse({ symbols: { minBodyLines: 0 } }),
      { generation: provider },
      false,
    );

    expect(
      provider.requests.every((request) => request.prefix === undefined),
    ).toBe(true);
  });

  it("judges only documentation fields enabled for output", async () => {
    const project = await loadProject({ tsconfigPath: fixtureRoot });
    const symbols = extractSymbols(project);
    const leaf = symbolId(symbols, "leaf");
    const provider = recordingProvider(new Set(), new Set(), {
      detail: "Detailed-only behavior.",
      returns: "A useful result.",
      throws: [{ type: "Error", when: "Detailed-only failure." }],
    });

    await generateProject(
      project,
      new Set([leaf]),
      configSchema.parse({
        symbols: { minBodyLines: 0 },
        docs: { granularity: "standard" },
      }),
      { generation: provider },
      false,
    );

    const judgeRequest = provider.requests.find((request) =>
      request.prompt.startsWith("Judge generated documentation"),
    );
    expect(judgeRequest?.prompt).toContain("A useful result.");
    expect(judgeRequest?.prompt).not.toContain("Detailed-only behavior.");
    expect(judgeRequest?.prompt).not.toContain("Detailed-only failure.");
  });
});

const recordingProvider = (
  skips: ReadonlySet<string> = new Set(),
  rejects: ReadonlySet<string> = new Set(),
  generatedDoc: Partial<GeneratedDoc> = {},
) => {
  const requests: ProviderRequest[] = [];
  const provider: LlmProvider & { readonly requests: ProviderRequest[] } = {
    id: "stub",
    requests,
    isRetryable: () => false,
    complete: async (request) => {
      requests.push(request);
      const id = idFromPrompt(request.prompt);
      if (request.prompt.startsWith("Judge generated documentation")) {
        return {
          value: {
            id,
            verdict: rejects.has(id) ? "REJECT" : "ACCEPT",
            reason: rejects.has(id)
              ? "Only restates the signature."
              : "Adds supported behavior.",
          },
          usage: {
            inputTokens: 2,
            outputTokens: 1,
            costUsd: 0.0001,
            costBasis: "usd",
          },
        };
      }
      const params = paramsFromPrompt(request.prompt);
      await Promise.resolve();
      return {
        value: skips.has(id)
          ? {
              id,
              summary: null,
              detail: null,
              params,
              returns: null,
              throws: [],
              verdict: "SKIP",
              reason: "Insufficient behavioral context.",
            }
          : {
              id,
              summary: `Generated ${id.slice(id.lastIndexOf("#") + 1)} behavior.`,
              detail: null,
              params,
              returns: null,
              throws: [],
              ...generatedDoc,
              verdict: "OK",
              reason: null,
            },
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          costUsd: 0.001,
          costBasis: "usd",
        },
      };
    },
  };
  return provider;
};

const symbolId = (
  symbols: ReturnType<typeof extractSymbols>,
  name: string,
): string => {
  const symbol = symbols.find((item) => item.name === name);
  if (symbol === undefined) throw new Error(`Expected symbol ${name}`);
  return symbol.id;
};

const idFromPrompt = (prompt: string): string => {
  const match = prompt.match(/id must be exactly ("[^"]+")/u);
  if (match?.[1] === undefined) throw new Error("Missing id in prompt");
  return JSON.parse(match[1]) as string;
};

const paramsFromPrompt = (prompt: string): Record<string, string> => {
  const match = prompt.match(
    /params must contain exactly these keys: (\[[^\n]+\])/u,
  );
  if (match?.[1] === undefined) throw new Error("Missing params in prompt");
  return Object.fromEntries(
    (JSON.parse(match[1]) as string[]).map((name) => [
      name,
      `Generated ${name}.`,
    ]),
  );
};
