import { describe, expect, it } from "vitest";

import { hashRecipe } from "../src/cli/workspace.js";
import { configSchema } from "../src/config/schema.js";
import { hashSymbol } from "../src/core/hash.js";
import { canonicalCode } from "../src/adapters/typescript/canonicalCode.js";
import { makeSymbolId, workspaceSymbolId } from "../src/core/id.js";
import type { Symbol as DocumentationSymbol } from "../src/core/symbol.js";
import { PROMPT_VERSION } from "../src/llm/prompt/index.js";

const recipe = {
  includeSourceNotes: true,
  contextRecipeVersion: "1",
  promptVersion: "none",
  configFingerprint: "policy",
} as const;

describe("symbol hashing", () => {
  it("feeds the active prompt version into the workspace hash recipe", () => {
    expect(hashRecipe(configSchema.parse({})).promptVersion).toBe(
      PROMPT_VERSION,
    );
  });

  it("ignores comments and formatting without joining tokens", () => {
    expect(canonicalCode("return foo /* note */ +  bar; // tail")).toBe(
      canonicalCode("return foo+bar;"),
    );
    expect(canonicalCode('return "http://example.test/*";')).not.toBe(
      canonicalCode('return "http:";'),
    );
    expect(canonicalCode("const template = `// literal`;")).toBe(
      canonicalCode("const template=`// literal`;"),
    );
    expect(canonicalCode("return left + +right;")).not.toBe(
      canonicalCode("return left++ +right;"),
    );
    expect(canonicalCode("return `value: ${item /* note */ .value}`;")).toBe(
      canonicalCode("return `value: ${item.value}`;"),
    );
  });

  it("keeps parameter names and optional source notes in the symbol hash", () => {
    const original = makeTestSymbol(
      "function parse(value: string): number",
      "return 1;",
    );
    const renamed = makeTestSymbol(
      "function parse(input: string): number",
      "return 1;",
    );
    const withoutNotes = { ...recipe, includeSourceNotes: false };

    expect(hashSymbol(original, recipe).symbolHash).not.toBe(
      hashSymbol(renamed, recipe).symbolHash,
    );
    expect(hashSymbol(original, recipe).symbolHash).not.toBe(
      hashSymbol(original, withoutNotes).symbolHash,
    );
  });

  it("ignores reformatting and line moves but detects body edits", () => {
    const original = makeTestSymbol(
      "function parse(value: string): number",
      "{\n  return value.length;\n}",
    );
    const reformatted = {
      ...original,
      declaration: {
        ...original.declaration,
        start: 400,
        end: 520,
        startLine: 30,
      },
      signature: "function  parse( value: string ): number",
      body: "{ return value.length ; } // unchanged",
    };
    const edited = { ...original, body: "{\n  return value.length + 1;\n}" };

    expect(
      hashSymbol(
        {
          ...reformatted,
          canonicalCode: canonicalCode(
            reformatted.signature + reformatted.body,
          ),
        },
        recipe,
      ).symbolHash,
    ).toBe(hashSymbol(original, recipe).symbolHash);
    expect(
      hashSymbol(
        {
          ...edited,
          canonicalCode: canonicalCode(edited.signature + edited.body),
        },
        recipe,
      ).symbolHash,
    ).not.toBe(hashSymbol(original, recipe).symbolHash);
  });
});

describe("symbol ids", () => {
  it("is independent of line positions and workspace-safe", () => {
    expect(makeSymbolId("src\\api.ts", "read", "Store")).toBe(
      "src/api.ts#Store.read",
    );
    expect(workspaceSymbolId("packages/core", "src/api.ts#Store.read")).toBe(
      "packages/core/src/api.ts#Store.read",
    );
  });
});

const makeTestSymbol = (
  signature: string,
  body: string,
): DocumentationSymbol => ({
  id: "src/example.ts#parse",
  name: "parse",
  kind: "function",
  filePath: "src/example.ts",
  signature,
  body,
  canonicalCode: canonicalCode(signature + body),
  parameters: [],
  asynchronous: false,
  exported: true,
  visibility: "public",
  declaration: {
    start: 100,
    end: 200,
    startLine: 10,
    startColumn: 1,
    endLine: 20,
    endColumn: 1,
  },
  existingDoc: null,
  sourceNote: {
    text: "Preserve insertion order.",
    raw: "// Preserve insertion order.\n",
    replacementEligible: true,
    range: {
      start: 70,
      end: 99,
      startLine: 9,
      startColumn: 1,
      endLine: 9,
      endColumn: 29,
    },
  },
});
