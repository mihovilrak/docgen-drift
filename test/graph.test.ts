import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { extractSymbols } from "../src/adapters/typescript/extract/index.js";
import { buildGraph } from "../src/adapters/typescript/graph.js";
import { loadProject } from "../src/adapters/typescript/loadProject.js";
import {
  reverseTopologicalOrder,
  reverseTopologicalLevels,
  stronglyConnectedComponents,
} from "../src/core/graph.js";

const fixtureRoot = resolve("test/fixtures/graph");

describe("TypeScript graph index", () => {
  it("builds forward and reverse edges in one call-expression traversal", async () => {
    const project = await loadProject({ tsconfigPath: fixtureRoot });
    const symbols = extractSymbols(project);
    const index = buildGraph(project, symbols, {
      testFilePaths: new Set([resolve(fixtureRoot, "src/service.test.ts")]),
    });
    const orchestrate = id(symbols, "orchestrate");
    const leaf = id(symbols, "leaf");

    expect(index.graph.forward).toContainEqual({ from: orchestrate, to: leaf });
    expect(index.graph.reverse).toContainEqual({ from: leaf, to: orchestrate });
    expect(index.context.callSites.get(orchestrate)).toHaveLength(2);
    expect(index.context.callSites.get(orchestrate)?.[0]).toMatchObject({
      enclosingFunction: "primaryCaller",
    });
    expect(index.context.callSites.get(orchestrate)?.[0]?.text).toContain(
      "export const primaryCaller",
    );
    expect(index.context.callSites.get(orchestrate)?.[0]?.text).not.toContain(
      "import { orchestrate }",
    );
    expect(index.context.testReferences.get(orchestrate)?.[0]).toMatchObject({
      names: ["payment conversion", "uses the payment amount"],
    });
  });

  it("condenses cycles and orders callees before callers", async () => {
    const project = await loadProject({ tsconfigPath: fixtureRoot });
    const symbols = extractSymbols(project);
    const graph = buildGraph(project, symbols).graph;
    const mutualA = id(symbols, "mutualA");
    const mutualB = id(symbols, "mutualB");
    const orchestrate = id(symbols, "orchestrate");
    const leaf = id(symbols, "leaf");

    expect(
      stronglyConnectedComponents(graph).find((component) =>
        component.members.includes(mutualA),
      )?.members,
    ).toEqual([mutualA, mutualB]);

    const order = reverseTopologicalOrder(graph);
    const position = (symbol: string): number =>
      order.findIndex((component) => component.members.includes(symbol));
    expect(position(leaf)).toBeLessThan(position(orchestrate));
    expect(position(mutualA)).toBeLessThan(position(orchestrate));

    const levels = reverseTopologicalLevels(graph);
    const levelOf = (symbol: string): number =>
      levels.findIndex((level) =>
        level.some((component) => component.members.includes(symbol)),
      );
    expect(levelOf(leaf)).toBeLessThan(levelOf(orchestrate));
    expect(levelOf(mutualA)).toBe(levelOf(mutualB));
  });

  it("extracts referenced type fields without methods", async () => {
    const project = await loadProject({ tsconfigPath: fixtureRoot });
    const symbols = extractSymbols(project);
    const orchestrate = id(symbols, "orchestrate");
    const index = buildGraph(project, symbols, {
      referencedTypeSymbolIds: new Set([orchestrate]),
    });
    const declaration =
      index.context.referencedTypes.get(orchestrate)?.[0]?.declaration;

    expect(declaration).toContain("invoiceId: string");
    expect(declaration).toContain("amount: number");
    expect(declaration).not.toContain("validate");
  });
});

const id = (
  symbols: ReturnType<typeof extractSymbols>,
  name: string,
): string => {
  const match = symbols.find((symbol) => symbol.name === name);
  if (match === undefined) throw new Error(`Expected ${name}`);
  return match.id;
};
