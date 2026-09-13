import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { extractSymbols } from "../src/adapters/typescript/extract/index.js";
import { loadProject } from "../src/adapters/typescript/loadProject.js";
import type { Symbol as DocumentationSymbol } from "../src/core/symbol.js";

const fixtureRoot = resolve("test/fixtures/typescript");

describe("TypeScript symbol extraction", () => {
  it("extracts every supported declaration kind without false positives", async () => {
    const project = await loadProject({ tsconfigPath: fixtureRoot });
    const symbols = extractSymbols(project);
    const identities = symbols.map((symbol) => `${symbol.kind}:${symbol.name}`);

    expect(identities).toEqual([
      "function:withTrailingComment",
      "function:withBodyComment",
      "function:stableSort",
      "function:detachedComment",
      "function:blockedComment",
      "function:parse",
      "function:completesAsynchronously",
      "class:DecoratedService",
      "method:run",
      "function:trace",
      "function:afterLicenseHeader",
      "function:afterTripleSlashReference",
      "function:afterShebang",
      "function:declaredFunction",
      "variable-function:arrowFunction",
      "variable-function:functionExpression",
      "class:Counter",
      "method:add",
      "method:reset",
      "method:snapshot",
      "getter:total",
      "setter:total",
      "class:HiddenService",
      "method:run",
      "interface:Store",
      "method-signature:read",
      "type-alias:Identifier",
      "enum:Status",
    ]);
  });

  it("extracts arrow functions and collapses overloads to the implementation", async () => {
    const project = await loadProject({ tsconfigPath: fixtureRoot });
    const symbols = extractSymbols(project);
    const arrow = getSymbol(symbols, "arrowFunction");
    const overloads = symbols.filter((symbol) => symbol.name === "parse");

    expect(arrow.kind).toBe("variable-function");
    expect(arrow.signature).toBe("const arrowFunction(value: number): number");
    expect(overloads).toHaveLength(1);
    expect(overloads[0]?.signature).toBe(
      "function parse(value: string | number): string | number",
    );
    expect(overloads[0]?.signature).not.toContain("return value");
  });

  it("unwraps async Promise<void> and computes declaration visibility", async () => {
    const project = await loadProject({ tsconfigPath: fixtureRoot });
    const symbols = extractSymbols(project);

    expect(getSymbol(symbols, "completesAsynchronously").returnsValue).toBe(
      false,
    );
    expect(getSymbol(symbols, "add").exported).toBe(true);
    expect(getSymbol(symbols, "reset")).toMatchObject({
      exported: false,
      visibility: "protected",
    });
    expect(getSymbol(symbols, "snapshot")).toMatchObject({
      exported: false,
      visibility: "private",
    });
    const hiddenMethod = symbols.find(
      (symbol) => symbol.id === "src/symbols.ts#HiddenService.run",
    );
    expect(hiddenMethod).toMatchObject({
      exported: false,
      visibility: "public",
    });
  });

  it("parses JSDoc tags and keeps unknown tags verbatim", async () => {
    const project = await loadProject({ tsconfigPath: fixtureRoot });
    const symbol = getSymbol(extractSymbols(project), "declaredFunction");

    expect(symbol.existingDoc?.description).toBe("Measures the input text.");
    expect(symbol.existingDoc?.tags).toEqual([
      expect.objectContaining({
        name: "param",
        parameterName: "input",
        text: "Text to measure.",
        known: true,
      }),
      expect.objectContaining({
        name: "returns",
        text: "The UTF-16 code unit count.",
        known: true,
      }),
      expect.objectContaining({
        name: "category",
        text: "measurement",
        known: false,
      }),
    ]);
    expect(symbol.existingDoc?.tags[2]?.raw).toContain("@category measurement");
  });

  it("classifies attached leading comment groups conservatively", async () => {
    const project = await loadProject({ tsconfigPath: fixtureRoot });
    const symbols = extractSymbols(project);

    const stableSortNote = getSymbol(symbols, "stableSort").sourceNote;
    expect(stableSortNote?.replacementEligible).toBe(true);
    expect(stableSortNote?.text).toContain("original insertion order");
    expect(getSymbol(symbols, "detachedComment").sourceNote).toBeNull();
    expect(getSymbol(symbols, "blockedComment").sourceNote).toMatchObject({
      replacementEligible: false,
      blockedBy: "directive",
    });
    expect(getSymbol(symbols, "afterLicenseHeader").sourceNote).toMatchObject({
      replacementEligible: false,
      blockedBy: "license",
    });
    expect(
      getSymbol(symbols, "afterTripleSlashReference").sourceNote,
    ).toMatchObject({
      replacementEligible: false,
      blockedBy: "triple-slash",
    });
    expect(getSymbol(symbols, "afterShebang").sourceNote).toBeNull();
    expect(getSymbol(symbols, "withTrailingComment").sourceNote).toBeNull();
    expect(getSymbol(symbols, "withBodyComment").sourceNote).toBeNull();
    expect(
      symbols.find(
        (symbol) => symbol.id === "src/edge-cases.ts#DecoratedService.run",
      )?.sourceNote,
    ).toMatchObject({ replacementEligible: true });
  });

  it("includes exported non-function variables only when configured", async () => {
    const project = await loadProject({ tsconfigPath: fixtureRoot });
    const defaultSymbols = extractSymbols(project);
    const configuredSymbols = extractSymbols(project, {
      includeNonFunctionVariables: true,
    });

    expect(
      defaultSymbols.some((symbol) => symbol.name === "defaultLimit"),
    ).toBe(false);
    expect(getSymbol(configuredSymbols, "defaultLimit").kind).toBe("variable");
    expect(
      getSymbol(configuredSymbols, "directiveTarget").sourceNote,
    ).toMatchObject({
      replacementEligible: false,
      blockedBy: "directive",
    });
  });
});

const getSymbol = (
  symbols: ReturnType<typeof extractSymbols>,
  name: string,
): DocumentationSymbol => {
  const symbol = symbols.find((candidate) => candidate.name === name);
  if (symbol === undefined) throw new Error(`Expected symbol ${name}`);
  return symbol;
};
