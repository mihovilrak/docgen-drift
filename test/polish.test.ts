import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import {
  loadProject,
  type TypeScriptProjectHandle,
} from "../src/adapters/typescript/loadProject.js";
import { extractSymbols } from "../src/adapters/typescript/extract/index.js";
import { buildGraph } from "../src/adapters/typescript/graph.js";
import {
  applyEdits,
  symbolAnchorHash,
} from "../src/adapters/typescript/applyEdits.js";
import { canonicalCode } from "../src/adapters/typescript/canonicalCode.js";
import { generateProject } from "../src/cli/generateProject.js";
import { configSchema } from "../src/config/schema.js";
import { hashSymbol, hashText } from "../src/core/hash.js";
import { hashRecipe } from "../src/cli/workspace.js";
import { createTaskLimiter } from "../src/core/concurrency.js";

const root = resolve("test/fixtures/polish");
const config = configSchema.parse({
  symbols: { minBodyLines: 0 },
  context: { sources: { gitSubject: false } },
});
let project: TypeScriptProjectHandle;
beforeAll(async () => {
  project = await loadProject({ tsconfigPath: root });
});

describe("release regression fixtures", () => {
  it.each([
    ["matches", "/a +b/", "/a+b/"],
    ["value", "value = ()", "value = async ()"],
    ["typed", "typed: () => number", "typed: () => number | undefined"],
    ["template", "before ${input} after", "changed ${input} after"],
    ["view", "hello world", "helloworld"],
    ["separated", "return;\n  input", "return input"],
  ])("detects behavioral changes to %s", (name, before, after) => {
    const file = project.sourceFiles[0];
    if (file === undefined) throw new Error("Missing fixture");
    const original = file.getFullText();
    const initial = extractSymbols(project).find(
      (symbol) => symbol.name === name,
    );
    try {
      file.replaceWithText(original.replace(before, after));
      const changed = extractSymbols(project).find(
        (symbol) => symbol.name === name,
      );
      if (initial === undefined || changed === undefined)
        throw new Error("Missing symbol");
      expect(hashSymbol(changed, hashRecipe(config)).symbolHash).not.toBe(
        hashSymbol(initial, hashRecipe(config)).symbolHash,
      );
      expect(symbolAnchorHash(changed)).not.toBe(symbolAnchorHash(initial));
    } finally {
      file.replaceWithText(original);
    }
  });

  it("ignores formatting, comments, semicolons and quote style", () => {
    expect(canonicalCode("function f(x: number) { return\nx; }")).not.toBe(
      canonicalCode("function f(x: number) { return x; }"),
    );
    expect(canonicalCode("const f = (x: number) => -x;")).not.toBe(
      canonicalCode("const f = (x: number) => +x;"),
    );
    expect(canonicalCode("const f = (x: number) => x++;")).not.toBe(
      canonicalCode("const f = (x: number) => x--;"),
    );
    expect(canonicalCode("const f = () => tag`\\n`;")).not.toBe(
      canonicalCode("const f = () => tag`\\x0a`;"),
    );
    expect(
      canonicalCode("const f = (x: string) => { /* note */ return 'a' + x; };"),
    ).toBe(canonicalCode('const f=(x:string)=>{return "a"+x}'));
    expect(canonicalCode("const f = () => `a ${`b ${1}`} c`;")).not.toBe(
      canonicalCode("const f = () => `a ${`changed ${1}`} c`;"),
    );
    expect(canonicalCode("const f = (x: number) => x / 2;")).not.toBe(
      canonicalCode("const f = (x: number) => x / 3;"),
    );
    expect(canonicalCode("const f = function() { return 1; };")).not.toBe(
      canonicalCode("const f = function*() { return 1; };"),
    );
  });

  it("keeps static and instance graph targets distinct", () => {
    const symbols = extractSymbols(project);
    expect(symbols.map((symbol) => symbol.id)).toEqual(
      expect.arrayContaining([
        "src/api.tsx#Store.read",
        "src/api.tsx#Store.read:static",
        "src/api.tsx#Store.size:getter",
        "src/api.tsx#Store.size:getter:static",
      ]),
    );
    const graph = buildGraph(project, symbols, {
      referencedTypeSymbolIds: new Set(),
    }).graph;
    expect(
      graph.forward.some(
        (edge) =>
          edge.from === "src/api.tsx#matches" &&
          edge.to === "src/api.tsx#Store.read:static",
      ),
    ).toBe(false);
    expect(graph.forward).toEqual(
      expect.arrayContaining([
        {
          from: "src/api.tsx#staticCaller",
          to: "src/api.tsx#Store.read:static",
        },
        { from: "src/api.tsx#instanceCaller", to: "src/api.tsx#Store.read" },
      ]),
    );
  });

  it("rejects ambiguous statements before any provider calls", async () => {
    let calls = 0;
    const result = await generateProject(
      project,
      new Set(["src/api.tsx#first", "src/api.tsx#second"]),
      config,
      {
        generation: {
          id: "stub",
          complete: () => {
            calls++;
            return Promise.reject(new Error("Must not call"));
          },
          isRetryable: () => false,
        },
      },
      false,
    );
    expect(calls).toBe(0);
    expect(result.failed).toHaveLength(2);
    expect(result.edits.files).toEqual([]);
  });

  it("rejects duplicate insertions before editing", async () => {
    const symbol = extractSymbols(project).find(
      (item) => item.name === "typed",
    );
    if (symbol === undefined) throw new Error("Missing symbol");
    const source = await readFile(resolve(root, symbol.filePath), "utf8");
    const plan = {
      symbol,
      doc: { summary: "Returns the fallback value.", params: {}, throws: [] },
      expectedFileHash: hashText(source),
      expectedAnchorHash: symbolAnchorHash(symbol),
    };
    const result = await applyEdits(
      project,
      [plan, { ...plan }],
      config,
      false,
    );
    expect(result.failed).toHaveLength(2);
    expect(result.files).toEqual([]);
  });

  it("bounds shared work across independent callers", async () => {
    const limited = createTaskLimiter(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 12 }, () =>
        limited(async () => {
          peak = Math.max(peak, ++active);
          await new Promise((resolve) => setTimeout(resolve, 1));
          active--;
        }),
      ),
    );
    expect(peak).toBe(2);
  });
});
