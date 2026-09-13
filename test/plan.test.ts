import { describe, expect, it } from "vitest";

import { EMPTY_DOC_HASH } from "../src/core/hash.js";
import { LOCK_SCHEMA_VERSION } from "../src/core/lock.js";
import { classifySymbols, type CurrentSymbol } from "../src/core/plan.js";
import type { Symbol as DocumentationSymbol } from "../src/core/symbol.js";

describe("check classification", () => {
  it("classifies unchanged, drifted, missing, and orphaned symbols", () => {
    const documented = symbol("src/api.ts#documented", true);
    const drifted = symbol("src/api.ts#drifted", true);
    const missing = symbol("src/api.ts#missing", false);
    const current = [
      item(documented, "same", "same-doc"),
      item(drifted, "new", "same-doc"),
      item(missing, "missing", "empty"),
    ];
    const results = classifySymbols(
      current,
      new Set(current.map(({ id }) => id)),
      {
        schemaVersion: LOCK_SCHEMA_VERSION,
        symbols: {
          [documented.id]: entry("same", "same-doc"),
          [drifted.id]: entry("old", "same-doc"),
          "src/api.ts#gone": entry("gone", "gone-doc"),
        },
      },
    );

    expect(
      Object.fromEntries(results.map((result) => [result.id, result.status])),
    ).toEqual({
      "src/api.ts#documented": "unchanged",
      "src/api.ts#drifted": "drifted",
      "src/api.ts#gone": "orphaned",
      "src/api.ts#missing": "missing",
    });
  });

  it("does not call policy-filtered symbols orphaned", () => {
    const lock = {
      schemaVersion: LOCK_SCHEMA_VERSION,
      symbols: { "src/internal.ts#hidden": entry("hash", "doc") },
    } as const;
    expect(
      classifySymbols([], new Set(["src/internal.ts#hidden"]), lock),
    ).toEqual([]);
  });

  it("does not call a removed undocumented symbol orphaned", () => {
    const lock = {
      schemaVersion: LOCK_SCHEMA_VERSION,
      symbols: { "src/api.ts#missing": entry("hash", EMPTY_DOC_HASH) },
    } as const;
    expect(classifySymbols([], new Set(), lock)).toEqual([]);
  });
});

const symbol = (id: string, documented: boolean): DocumentationSymbol => ({
  id,
  name: id.slice(id.indexOf("#") + 1),
  kind: "function",
  filePath: id.slice(0, id.indexOf("#")),
  signature: "function example(): void",
  body: "return;",
  parameters: [],
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
  existingDoc: documented
    ? {
        description: "Does work.",
        tags: [],
        raw: "/** Does work. */",
        range: {
          start: 0,
          end: 20,
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: 21,
        },
      }
    : null,
  sourceNote: null,
});

const item = (
  documentationSymbol: DocumentationSymbol,
  symbolHash: string,
  docHash: string,
): CurrentSymbol => ({
  id: documentationSymbol.id,
  symbol: documentationSymbol,
  hashes: { symbolHash, docHash },
});

const entry = (symbolHash: string, docHash: string) => ({
  symbolHash,
  docHash,
  filePath: "src/api.ts",
  startLine: 1,
});
