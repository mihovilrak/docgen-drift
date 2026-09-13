import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { filterByChanges, readChangedFiles } from "../src/cli/since.js";
import type { CheckResult } from "../src/core/plan.js";
import type { Symbol as DocumentationSymbol } from "../src/core/symbol.js";

const execFileAsync = promisify(execFile);

describe("--since", () => {
  it("keeps only symbols whose current declaration intersects a diff hunk", async () => {
    const root = await mkdtemp(join(tmpdir(), "docgen-since-"));
    const path = join(root, "api.ts");
    await execFileAsync("git", ["init", "--quiet"], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "test@example.test"], {
      cwd: root,
    });
    await execFileAsync("git", ["config", "user.name", "Docgen Test"], {
      cwd: root,
    });
    await writeFile(path, "first();\nsecond();\n", "utf8");
    await execFileAsync("git", ["add", "api.ts"], { cwd: root });
    await execFileAsync("git", ["commit", "--quiet", "-m", "baseline"], {
      cwd: root,
    });
    await writeFile(path, "first();\nchanged();\n", "utf8");

    const changed = await readChangedFiles(root, "HEAD");
    expect(
      filterByChanges(
        [checkResult("first", 1), checkResult("second", 2)],
        changed,
      ).map(({ id }) => id),
    ).toEqual(["api.ts#second"]);

    await execFileAsync("git", ["checkout", "--", "api.ts"], { cwd: root });
    await execFileAsync("git", ["rm", "--quiet", "api.ts"], { cwd: root });
    const deleted = await readChangedFiles(root, "HEAD");
    expect(
      filterByChanges([orphanResult()], deleted).map(({ id }) => id),
    ).toEqual(["api.ts#gone"]);
  });
});

const checkResult = (name: string, line: number): CheckResult => ({
  id: `api.ts#${name}`,
  status: "drifted",
  filePath: "api.ts",
  startLine: line,
  symbol: symbol(name, line),
});

const symbol = (name: string, line: number): DocumentationSymbol => ({
  id: `api.ts#${name}`,
  name,
  kind: "function",
  filePath: "api.ts",
  signature: `function ${name}(): void`,
  body: "",
  parameters: [],
  asynchronous: false,
  exported: true,
  visibility: "public",
  declaration: {
    start: 0,
    end: 1,
    startLine: line,
    startColumn: 1,
    endLine: line,
    endColumn: 2,
  },
  existingDoc: null,
  sourceNote: null,
});

const orphanResult = (): CheckResult => ({
  id: "api.ts#gone",
  status: "orphaned",
  filePath: "api.ts",
  startLine: 1,
});
