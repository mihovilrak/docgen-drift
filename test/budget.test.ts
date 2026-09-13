import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { extractSymbols } from "../src/adapters/typescript/extract/index.js";
import { buildGraph } from "../src/adapters/typescript/graph.js";
import { loadProject } from "../src/adapters/typescript/loadProject.js";
import {
  assembleContext,
  createTokenCounter,
  sampleCallSites,
} from "../src/core/budget.js";

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
