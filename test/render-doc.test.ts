import { describe, expect, it } from "vitest";

import { renderDoc } from "../src/adapters/typescript/renderDoc.js";
import type {
  ExistingDocTag,
  GeneratedDoc,
  Symbol as DocumentationSymbol,
} from "../src/core/symbol.js";

describe("JSDoc rendering", () => {
  it("renders AST-owned tags without TypeScript type annotations", () => {
    const result = renderDoc(doc(), symbol(), {
      indentation: "  ",
      eol: "\r\n",
      preserveTags: ["deprecated"],
    });

    expect(result).toContain("\r\n   * @param value Value to normalize.");
    expect(result).toContain("\r\n   * @returns The normalized value.");
    expect(result).toContain(
      "\r\n   * @throws RangeError When value is negative.",
    );
    expect(result).not.toContain("{number}");
  });

  it("merges unknown and configured preserved tags while replacing owned tags", () => {
    const result = renderDoc(
      doc(),
      symbol([
        tag("category", false),
        tag("deprecated", true),
        tag("param", true),
      ]),
      {
        preserveTags: ["deprecated"],
      },
    );

    expect(result).toContain(" * @category normalization");
    expect(result).toContain(" * @deprecated Use normalizeV2.");
    expect(result.match(/@param value/gu)).toHaveLength(1);
    expect(result).not.toContain("Old parameter text");
  });

  it("wraps prose and tag descriptions at the line width, counting indentation", () => {
    const long =
      "Resolve the configured provider for this run and fall back to the generation provider when the judge has none of its own.";
    const result = renderDoc(
      {
        ...doc(),
        summary: long,
        detail: `${long}\n- ${long}\n\n\`\`\`ts\n${long}\n\`\`\``,
        params: { value: long },
      },
      symbol(),
      { indentation: "    ", lineWidth: 60, maxLineWidth: 70 },
    );
    const lines = result.split("\n");
    const prose = lines.filter((line) => !line.includes("fall back to the"));

    expect(prose.every((line) => line.length <= 60)).toBe(true);
    expect(lines).toContain(`     * ${long}`);
    expect(lines).toContain(
      "     * - Resolve the configured provider for this run and",
    );
    expect(lines).toContain(
      "     *   fall back to the generation provider when the judge",
    );
    expect(lines).toContain(
      "     * @param value Resolve the configured provider for this",
    );
    expect(lines).toContain(
      "     *   run and fall back to the generation provider when",
    );
    expect(lines).toContain("     *   the judge has none of its own.");
  });

  it("lets a paragraph's last words run to the max line width", () => {
    const result = renderDoc(
      { ...doc(), summary: "a".repeat(20) + " tail", params: {} },
      symbol(),
      { lineWidth: 20, maxLineWidth: 30 },
    );

    expect(result).toContain(` * ${"a".repeat(20)} tail`);
    expect(result).toContain(" * @param value\n");
  });

  it("escapes comment terminators from semantic model text", () => {
    expect(
      renderDoc({ ...doc(), summary: "Avoid */ termination." }, symbol()),
    ).toContain("Avoid *\\/ termination.");
  });
});

const doc = (): GeneratedDoc => ({
  summary: "Normalize the supplied value.",
  detail: "Rejects values outside the supported domain.",
  params: { value: "Value to normalize." },
  returns: "The normalized value.",
  throws: [{ type: "RangeError", when: "When value is negative." }],
});

const tag = (name: string, known: boolean): ExistingDocTag => ({
  name,
  text:
    name === "category"
      ? "normalization"
      : name === "deprecated"
        ? "Use normalizeV2."
        : "Old parameter text",
  raw:
    name === "category"
      ? "@category normalization"
      : name === "deprecated"
        ? "@deprecated Use normalizeV2."
        : "@param value Old parameter text",
  known,
});

const symbol = (tags: readonly ExistingDocTag[] = []): DocumentationSymbol => ({
  id: "src/api.ts#normalize",
  name: "normalize",
  kind: "function",
  filePath: "src/api.ts",
  signature: "function normalize(value: number): number",
  body: "return value;",
  parameters: [
    { name: "value", text: "value: number", optional: false, rest: false },
  ],
  returnsValue: true,
  asynchronous: false,
  exported: true,
  visibility: "public",
  declaration: {
    start: 100,
    end: 140,
    startLine: 5,
    startColumn: 1,
    endLine: 7,
    endColumn: 2,
  },
  existingDoc:
    tags.length === 0
      ? null
      : {
          description: "Old description.",
          tags,
          raw: "/** Old description. */",
          range: {
            start: 75,
            end: 99,
            startLine: 4,
            startColumn: 1,
            endLine: 4,
            endColumn: 25,
          },
        },
  sourceNote: null,
});
