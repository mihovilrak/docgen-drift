import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyEdits,
  symbolAnchorHash,
  type PlannedDocEdit,
} from "../src/adapters/typescript/applyEdits.js";
import { extractSymbols } from "../src/adapters/typescript/extract/index.js";
import { loadProject } from "../src/adapters/typescript/loadProject.js";
import { configSchema } from "../src/config/schema.js";
import { hashText } from "../src/core/hash.js";
import type {
  GeneratedDoc,
  Symbol as DocumentationSymbol,
} from "../src/core/symbol.js";

const fixtureRoot = resolve("test/fixtures/generation");

describe("TypeScript edit application", () => {
  it("applies multiple edits bottom-up with indentation, EOL, formatting, and a clean reparse", async () => {
    const root = await copyFixture();
    const sourcePath = join(root, "src/api.ts");
    const source = (await readFile(sourcePath, "utf8")).replace(/\n/gu, "\r\n");
    await writeFile(sourcePath, source, "utf8");
    const project = await loadProject({ tsconfigPath: root });
    const symbols = extractSymbols(project);
    const plans = [
      plan(findSymbol(symbols, "leaf"), source),
      plan(findSymbol(symbols, "caller"), source),
    ];

    const result = await applyEdits(
      project,
      plans,
      configSchema.parse({ symbols: { minBodyLines: 0 } }),
      true,
    );

    expect(result.failed).toEqual([]);
    expect(result.applied).toEqual(["src/api.ts#caller", "src/api.ts#leaf"]);
    const written = await readFile(sourcePath, "utf8");
    expect(written).toContain("/**\r\n * Document caller behavior.");
    expect(written).toContain("/**\r\n * Document leaf behavior.");
    expect(written).toContain("    return leaf(value) * 2;");
    expect(written).not.toMatch(/(?<!\r)\n/u);

    const reparsed = await loadProject({ tsconfigPath: root });
    expect(
      reparsed.project.getSourceFileOrThrow(sourcePath).getPreEmitDiagnostics(),
    ).toEqual([]);
  });

  it("honors standard granularity when rendering model output", async () => {
    const root = await copyFixture();
    const sourcePath = join(root, "src/api.ts");
    const source = await readFile(sourcePath, "utf8");
    const project = await loadProject({ tsconfigPath: root });
    const leaf = findSymbol(extractSymbols(project), "leaf");
    const doc: GeneratedDoc = {
      ...generatedDoc(leaf),
      detail: "Internal calculation detail.",
      throws: [{ type: "RangeError", when: "The value is negative." }],
    };

    await applyEdits(
      project,
      [plan(leaf, source, doc)],
      configSchema.parse({
        symbols: { minBodyLines: 0 },
        docs: { granularity: "standard" },
      }),
      true,
    );

    const written = await readFile(sourcePath, "utf8");
    expect(written).toContain("@param value Input value.");
    expect(written).toContain("@returns The computed value.");
    expect(written).not.toContain("Internal calculation detail.");
    expect(written).not.toContain("@throws");
  });

  it("renders only the summary at minimal granularity", async () => {
    const root = await copyFixture();
    const sourcePath = join(root, "src/api.ts");
    const source = await readFile(sourcePath, "utf8");
    const project = await loadProject({ tsconfigPath: root });
    const leaf = findSymbol(extractSymbols(project), "leaf");
    const doc: GeneratedDoc = {
      ...generatedDoc(leaf),
      detail: "Internal calculation detail.",
      throws: [{ type: "RangeError", when: "The value is negative." }],
    };

    await applyEdits(
      project,
      [plan(leaf, source, doc)],
      configSchema.parse({
        symbols: { minBodyLines: 0 },
        docs: { granularity: "minimal" },
      }),
      true,
    );

    const written = await readFile(sourcePath, "utf8");
    expect(written).toContain("Document leaf behavior.");
    expect(written).not.toContain("Internal calculation detail.");
    expect(written).not.toContain("@param");
    expect(written).not.toContain("@returns");
    expect(written).not.toContain("@throws");
  });

  it("reparses a changed file and rejects a symbol changed after generation", async () => {
    const root = await copyFixture();
    const sourcePath = join(root, "src/api.ts");
    const source = await readFile(sourcePath, "utf8");
    const project = await loadProject({ tsconfigPath: root });
    const caller = findSymbol(extractSymbols(project), "caller");
    await writeFile(sourcePath, source.replace("* 2", "* 3"), "utf8");

    const result = await applyEdits(
      project,
      [plan(caller, source)],
      configSchema.parse({ symbols: { minBodyLines: 0 } }),
      true,
    );

    expect(result.applied).toEqual([]);
    expect(result.failed).toEqual([
      { symbolId: caller.id, reason: "Symbol changed after generation" },
    ]);
    expect(await readFile(sourcePath, "utf8")).not.toContain("/**");
  });

  it("leaves the file untouched when the candidate does not parse", async () => {
    const root = await copyFixture();
    const sourcePath = join(root, "src/api.ts");
    const source = await readFile(sourcePath, "utf8");
    const project = await loadProject({ tsconfigPath: root });
    const leaf = findSymbol(extractSymbols(project), "leaf");
    const concurrentlyBroken = `${source}\nexport const broken = ;\n`;
    await writeFile(sourcePath, concurrentlyBroken, "utf8");

    const result = await applyEdits(
      project,
      [plan(leaf, source)],
      configSchema.parse({ symbols: { minBodyLines: 0 } }),
      true,
    );

    expect(result.applied).toEqual([]);
    expect(result.failed).toEqual([
      { symbolId: leaf.id, reason: "Generated edit did not parse cleanly" },
    ]);
    expect(await readFile(sourcePath, "utf8")).toBe(concurrentlyBroken);
  });

  it("atomically replaces only an eligible attached source note", async () => {
    const root = await copyFixture();
    const sourcePath = join(root, "src/api.ts");
    const source = (await readFile(sourcePath, "utf8")).replace(
      "export const leaf",
      "// Adds one so callers can reserve zero.\nexport const leaf",
    );
    await writeFile(sourcePath, source, "utf8");
    const project = await loadProject({ tsconfigPath: root });
    const leaf = findSymbol(extractSymbols(project), "leaf");

    const result = await applyEdits(
      project,
      [plan(leaf, source)],
      configSchema.parse({
        symbols: { minBodyLines: 0 },
        docs: { leadingComments: { onGenerate: "replace" } },
      }),
      true,
    );

    expect(result.failed).toEqual([]);
    const written = await readFile(sourcePath, "utf8");
    expect(written).not.toContain("// Adds one so callers can reserve zero.");
    expect(written).toContain("/**\n * Document leaf behavior.");
  });

  it("renders detail for a replaced note even at standard granularity", async () => {
    const root = await copyFixture();
    const sourcePath = join(root, "src/api.ts");
    const source = (await readFile(sourcePath, "utf8")).replace(
      "export const leaf",
      "// Adds one so callers can reserve zero.\nexport const leaf",
    );
    await writeFile(sourcePath, source, "utf8");
    const project = await loadProject({ tsconfigPath: root });
    const leaf = findSymbol(extractSymbols(project), "leaf");
    const doc = {
      ...generatedDoc(leaf),
      detail: "Adds one so callers can reserve zero.",
    };

    const result = await applyEdits(
      project,
      [plan(leaf, source, doc)],
      configSchema.parse({
        symbols: { minBodyLines: 0 },
        docs: {
          granularity: "standard",
          leadingComments: { onGenerate: "replace" },
        },
      }),
      true,
    );

    expect(result.failed).toEqual([]);
    const written = await readFile(sourcePath, "utf8");
    expect(written).not.toContain("// Adds one");
    expect(written).toContain(" * Adds one so callers can reserve zero.");
  });

  it("never replaces a directive source-note group", async () => {
    const root = await copyFixture();
    const sourcePath = join(root, "src/api.ts");
    const source = (await readFile(sourcePath, "utf8")).replace(
      "export const leaf",
      "// eslint-disable-next-line no-warning-comments\nexport const leaf",
    );
    await writeFile(sourcePath, source, "utf8");
    const project = await loadProject({ tsconfigPath: root });
    const leaf = findSymbol(extractSymbols(project), "leaf");

    await applyEdits(
      project,
      [plan(leaf, source)],
      configSchema.parse({
        symbols: { minBodyLines: 0 },
        docs: { leadingComments: { onGenerate: "replace" } },
      }),
      true,
    );

    const written = await readFile(sourcePath, "utf8");
    expect(written).toContain(
      "// eslint-disable-next-line no-warning-comments",
    );
    expect(written.indexOf("// eslint-disable")).toBeLessThan(
      written.indexOf("/**\n * Document leaf behavior."),
    );
  });

  it("preserves an eligible source note after a concurrent change", async () => {
    const root = await copyFixture();
    const sourcePath = join(root, "src/api.ts");
    const source = (await readFile(sourcePath, "utf8")).replace(
      "export const leaf",
      "// Original behavioral note.\nexport const leaf",
    );
    await writeFile(sourcePath, source, "utf8");
    const project = await loadProject({ tsconfigPath: root });
    const leaf = findSymbol(extractSymbols(project), "leaf");
    const changed = source.replace("Original behavioral", "Changed behavioral");
    await writeFile(sourcePath, changed, "utf8");

    const result = await applyEdits(
      project,
      [plan(leaf, source)],
      configSchema.parse({
        symbols: { minBodyLines: 0 },
        docs: { leadingComments: { onGenerate: "replace" } },
      }),
      true,
    );

    expect(result.applied).toEqual([]);
    expect(await readFile(sourcePath, "utf8")).toBe(changed);
  });

  it("preserves the source file when its atomic write fails", async () => {
    const root = await copyFixture();
    const sourcePath = join(root, "src/api.ts");
    const source = (await readFile(sourcePath, "utf8")).replace(
      "export const leaf",
      "// Original behavioral note.\nexport const leaf",
    );
    await writeFile(sourcePath, source, "utf8");
    const project = await loadProject({ tsconfigPath: root });
    const leaf = findSymbol(extractSymbols(project), "leaf");

    const result = await applyEdits(
      project,
      [plan(leaf, source)],
      configSchema.parse({
        symbols: { minBodyLines: 0 },
        docs: { leadingComments: { onGenerate: "replace" } },
      }),
      true,
      () => Promise.reject(new Error("simulated write failure")),
    );

    expect(result.applied).toEqual([]);
    expect(result.failed).toEqual([
      { symbolId: leaf.id, reason: "simulated write failure" },
    ]);
    expect(await readFile(sourcePath, "utf8")).toBe(source);
  });
});

const copyFixture = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "docgen-generation-"));
  await cp(fixtureRoot, root, { recursive: true });
  return root;
};

const plan = (
  symbol: DocumentationSymbol,
  source: string,
  doc: GeneratedDoc = generatedDoc(symbol),
): PlannedDocEdit => ({
  symbol,
  doc,
  expectedFileHash: hashText(source),
  expectedAnchorHash: symbolAnchorHash(symbol),
});

const generatedDoc = (symbol: DocumentationSymbol): GeneratedDoc => ({
  summary: `Document ${symbol.name} behavior.`,
  params: Object.fromEntries(
    symbol.parameters.map((parameter) => [parameter.name, "Input value."]),
  ),
  returns: "The computed value.",
  throws: [],
});

const findSymbol = (
  symbols: readonly DocumentationSymbol[],
  name: string,
): DocumentationSymbol => {
  const symbol = symbols.find((item) => item.name === name);
  if (symbol === undefined) throw new Error(`Expected symbol ${name}`);
  return symbol;
};
