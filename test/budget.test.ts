import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { extractSymbols } from "../src/adapters/typescript/extract/index.js";
import { buildGraph } from "../src/adapters/typescript/graph.js";
import { loadProject } from "../src/adapters/typescript/loadProject.js";
import {
  assembleContext,
  conservativeTokenCount,
  createTokenCounter,
  sampleCallSites,
  type AssembleContextOptions,
} from "../src/core/budget.js";
import { assembleFileContext } from "../src/core/fileContext.js";
import type { LlmProvider } from "../src/llm/client.js";
import { tokenCounter } from "../src/llm/tokenizer.js";

const fixtureRoot = resolve("test/fixtures/graph");

describe("context budget", () => {
  it("ranks source notes first and never exceeds the target-model budget", async () => {
    const project = await loadProject({ tsconfigPath: fixtureRoot });
    const symbols = extractSymbols(project);
    const symbol = symbols.find(
      (candidate) => candidate.name === "orchestrate",
    );
    if (symbol === undefined) throw new Error("Expected orchestrate");
    const index = buildGraph(project, symbols, {
      testFilePaths: new Set([resolve(fixtureRoot, "src/service.test.ts")]),
      referencedTypeSymbolIds: new Set([symbol.id]),
    });
    const context = assembleContext({
      symbol,
      symbols,
      graph: index.graph,
      index: index.context,
      budgetTokens: 80,
      model: "claude-sonnet-5",
      sources: {
        testNames: true,
        ownBody: true,
        callSites: true,
        calleeSummaries: true,
        referencedTypes: true,
        gitSubject: false,
        calleeBodies: false,
      },
      includeSourceNotes: true,
      bodyMaxLines: 120,
      callSiteMax: 5,
      callSiteSampling: "moduleDiversity",
    });

    expect(context.text).toContain("SOURCE NOTES (untrusted");
    expect(context.included[0]).toBe("sourceNote");
    expect(context.tokenCount).toBeLessThanOrEqual(context.tokenBudget);
    expect(context.omitted.length).toBeGreaterThan(0);
    expect(createTokenCounter(context.model).count(context.text)).toBe(
      context.tokenCount,
    );

    const withoutNotes = assembleContext({
      symbol,
      symbols,
      graph: index.graph,
      index: index.context,
      budgetTokens: 2_000,
      model: "claude-sonnet-5",
      sources: {
        testNames: false,
        ownBody: false,
        callSites: false,
        calleeSummaries: true,
        referencedTypes: false,
        gitSubject: false,
        calleeBodies: false,
      },
      includeSourceNotes: false,
      bodyMaxLines: 120,
      callSiteMax: 5,
      callSiteSampling: "moduleDiversity",
      calleeSummaries: new Map(
        index.graph.forward
          .filter((edge) => edge.from === symbol.id)
          .map((edge) => [edge.to, "Performs the dependency step."]),
      ),
    });
    expect(withoutNotes.text).not.toContain("SOURCE NOTES");
    expect(withoutNotes.text).toContain("CALLEE SUMMARY");
  });

  it("samples distinct modules before duplicate modules", () => {
    const sites = [
      site("src/a.ts", "src"),
      site("src/b.ts", "src"),
      site("packages/pay/a.ts", "packages/pay"),
    ];
    expect(
      sampleCallSites(sites, 2, "moduleDiversity").map((item) => item.filePath),
    ).toEqual(["src/a.ts", "packages/pay/a.ts"]);
  });
});

const site = (filePath: string, modulePath: string) => ({
  callee: "target",
  filePath,
  modulePath,
  line: 1,
  text: "target()",
});

describe("provider tokenizers", () => {
  const provider = (
    countTokens?: (text: string, model: string) => number,
  ): LlmProvider => ({
    id: "stub",
    complete: () => {
      throw new Error("not called");
    },
    isRetryable: () => false,
    ...(countTokens === undefined ? {} : { countTokens }),
  });

  it("falls back to the conservative estimate when a provider has no tokenizer", () => {
    expect(tokenCounter(provider(), "any-model")("const a = 1;")).toBe(
      conservativeTokenCount("const a = 1;"),
    );
  });

  it("passes the target model to a provider tokenizer", () => {
    const seen: string[] = [];
    const count = tokenCounter(
      provider((text, model) => {
        seen.push(model);
        return text.length;
      }),
      "local-model",
    );
    expect(count("abcd")).toBe(4);
    expect(seen).toEqual(["local-model"]);
  });

  it("lets a provider tokenizer change what fits in the budget", async () => {
    const project = await loadProject({ tsconfigPath: fixtureRoot });
    const symbols = extractSymbols(project);
    const symbol = symbols.find(
      (candidate) => candidate.name === "orchestrate",
    );
    if (symbol === undefined) throw new Error("Expected orchestrate");
    const index = buildGraph(project, symbols, {
      testFilePaths: new Set([resolve(fixtureRoot, "src/service.test.ts")]),
      referencedTypeSymbolIds: new Set([symbol.id]),
    });
    const options: AssembleContextOptions = {
      symbol,
      symbols,
      graph: index.graph,
      index: index.context,
      budgetTokens: 400,
      model: "local-model",
      sources: {
        testNames: true,
        ownBody: true,
        callSites: true,
        calleeSummaries: true,
        referencedTypes: true,
        gitSubject: false,
        calleeBodies: false,
      },
      includeSourceNotes: true,
      bodyMaxLines: 120,
      callSiteMax: 5,
      callSiteSampling: "moduleDiversity",
    };

    const fallback = assembleContext(options);
    const doubled = assembleContext({
      ...options,
      countTokens: (text) => conservativeTokenCount(text) * 2,
    });

    expect(doubled.included.length).toBeLessThan(fallback.included.length);
    expect(doubled.tokenCount).toBeLessThanOrEqual(doubled.tokenBudget);
    expect(
      createTokenCounter(
        doubled.model,
        (text) => conservativeTokenCount(text) * 2,
      ).count(doubled.text),
    ).toBe(doubled.tokenCount);
  });
});

describe("shared module outline", () => {
  const outline = async (
    file: string,
    budgetTokens = 2_000,
    entryMaxTokens?: number,
  ) => {
    const project = await loadProject({ tsconfigPath: fixtureRoot });
    return assembleFileContext({
      filePath: file,
      symbols: extractSymbols(project),
      budgetTokens,
      model: "claude-sonnet-5",
      ...(entryMaxTokens === undefined ? {} : { entryMaxTokens }),
    });
  };

  it("lists every sibling declaration in declaration order", async () => {
    const context = await outline("src/service.ts");

    expect(context.text).toContain("MODULE: src/service.ts");
    expect(context.text).toContain("MODULE DECLARATIONS");
    expect(
      [...context.text.matchAll(/^- \S+ (\w+)/gmu)].map((match) => match[1]),
    ).toEqual(["leaf", "mutualA", "mutualB", "orchestrate"]);
    expect(context.tokenCount).toBe(
      createTokenCounter("claude-sonnet-5").count(context.text),
    );
    expect(context.declaredNames.size).toBe(0);
  });

  it("renders interface fields and marks the name as substitutable", async () => {
    const context = await outline("src/types.ts");

    expect(context.text).toContain("- interface PaymentInput {");
    expect(context.text).toContain("invoiceId: string;");
    expect(context.text).not.toContain("- PaymentInput.validate");
    expect([...context.declaredNames]).toEqual(["PaymentInput"]);
  });

  it("keeps a truncated entry out of the substitutable names", async () => {
    const context = await outline("src/types.ts", 2_000, 4);

    expect(context.text).not.toContain("validate(): boolean;");
    expect(context.declaredNames.size).toBe(0);
  });

  it("never exceeds its own budget and yields nothing when it cannot fit", async () => {
    const tight = await outline("src/service.ts", 60);
    expect(tight.tokenCount).toBeLessThanOrEqual(60);

    const empty = await outline("src/service.ts", 5);
    expect(empty.text).toBe("");
    expect(empty.tokenCount).toBe(0);
  });

  it("drops a per-symbol referenced type the outline already renders", async () => {
    const project = await loadProject({ tsconfigPath: fixtureRoot });
    const symbols = extractSymbols(project);
    const symbol = symbols.find(
      (candidate) => candidate.name === "orchestrate",
    );
    if (symbol === undefined) throw new Error("Expected orchestrate");
    const index = buildGraph(project, symbols, {
      testFilePaths: new Set([resolve(fixtureRoot, "src/service.test.ts")]),
      referencedTypeSymbolIds: new Set([symbol.id]),
    });
    const options: AssembleContextOptions = {
      symbol,
      symbols,
      graph: index.graph,
      index: index.context,
      budgetTokens: 2_000,
      model: "claude-sonnet-5",
      sources: {
        testNames: false,
        ownBody: false,
        callSites: false,
        calleeSummaries: false,
        referencedTypes: true,
        gitSubject: false,
        calleeBodies: false,
      },
      includeSourceNotes: false,
      bodyMaxLines: 120,
      callSiteMax: 5,
      callSiteSampling: "moduleDiversity",
    };

    expect(assembleContext(options).text).toContain("REFERENCED TYPE");
    expect(
      assembleContext({
        ...options,
        sharedDeclaredNames: new Set(["PaymentInput"]),
      }).text,
    ).not.toContain("REFERENCED TYPE");
  });
});
