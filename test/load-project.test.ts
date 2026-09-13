import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadProject } from "../src/adapters/typescript/loadProject.js";

const fixtureRoot = resolve("test/fixtures/typescript");

describe("loadProject", () => {
  it("resolves a directory tsconfig and honors its file set", async () => {
    const project = await loadProject({ tsconfigPath: fixtureRoot });
    const files = project.sourceFiles.map((file) => file.getBaseName()).sort();

    expect(project.tsconfigPath).toBe(resolve(fixtureRoot, "tsconfig.json"));
    expect(files).toEqual([
      "comments.ts",
      "edge-cases.ts",
      "license.ts",
      "reference.ts",
      "shebang.ts",
      "symbols.ts",
    ]);
  });

  it("applies adapter include and exclude globs", async () => {
    const project = await loadProject({
      tsconfigPath: fixtureRoot,
      include: ["src/*.ts"],
      exclude: ["**/edge-cases.ts", "**/symbols.ts"],
    });

    expect(
      project.sourceFiles.map((file) => file.getBaseName()).sort(),
    ).toEqual(["comments.ts", "license.ts", "reference.ts", "shebang.ts"]);
  });
});
