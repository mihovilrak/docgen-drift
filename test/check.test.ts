import { cp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mkdtemp } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { configSchema, type DocgenConfig } from "../src/config/schema.js";
import { runBaseline, runCheck } from "../src/cli/run.js";
import { scopeProjects } from "../src/cli/projectScope.js";

const fixtureRoot = resolve("test/fixtures/monorepo");

describe("baseline and check", () => {
  it("scopes shared-lock orphans by project while retaining real deletions", async () => {
    const root = await copyFixture();
    await removeOverlappingOwnership(root);
    const all = config("shared", 1);
    await runBaseline(root, all);
    const scoped = scopeProjects(all, "packages/alpha");
    expect((await runCheck(root, scoped)).results.map(statusPair)).toEqual([
      ["packages/alpha/src/index.ts#alpha", "unchanged"],
    ]);
    await writeFile(
      join(root, "packages/alpha/src/index.ts"),
      "export {};\n",
      "utf8",
    );
    expect((await runCheck(root, scoped)).results.map(statusPair)).toEqual([
      ["packages/alpha/src/index.ts#alpha", "orphaned"],
    ]);
  });
  it(
    "classifies shared and per-project locks identically without changing source",
    { timeout: 60_000 },
    async () => {
      const root = await copyFixture();
      await removeOverlappingOwnership(root);
      const sourcePath = join(root, "packages/alpha/src/index.ts");
      const originalSource = await readFile(sourcePath, "utf8");
      const shared = config("shared", 2);

      const baseline = await runBaseline(root, shared);
      expect(baseline).toMatchObject({ symbols: 2 });
      expect(await readFile(sourcePath, "utf8")).toBe(originalSource);
      expect((await runCheck(root, shared)).results.map(statusPair)).toEqual([
        ["packages/alpha/src/index.ts#alpha", "unchanged"],
        ["packages/beta/src/index.ts#beta", "unchanged"],
      ]);

      await writeFile(
        sourcePath,
        originalSource.replace('return "alpha";', 'return "alpha-v2";'),
        "utf8",
      );
      const sharedAfterEdit = (await runCheck(root, shared)).results.map(
        statusPair,
      );
      expect(sharedAfterEdit).toEqual([
        ["packages/alpha/src/index.ts#alpha", "drifted"],
        ["packages/beta/src/index.ts#beta", "unchanged"],
      ]);

      await writeFile(sourcePath, originalSource, "utf8");
      const perProject = config("perProject", 2);
      await runBaseline(root, perProject);
      await writeFile(
        sourcePath,
        originalSource.replace('return "alpha";', 'return "alpha-v2";'),
        "utf8",
      );
      expect(
        (await runCheck(root, perProject)).results.map(statusPair),
      ).toEqual(sharedAfterEdit);
      expect(await readFile(sourcePath, "utf8")).toContain(
        'return "alpha-v2";',
      );
    },
  );
});

const config = (
  lockfile: "shared" | "perProject",
  projectConcurrency: number,
): DocgenConfig =>
  configSchema.parse({
    include: ["src/**/*.ts"],
    workspace: {
      projects: ["packages/*/tsconfig.json"],
      lockfile,
      projectConcurrency,
    },
    symbols: { minBodyLines: 0 },
  });

const copyFixture = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "docgen-check-"));
  await cp(fixtureRoot, root, { recursive: true });
  return root;
};

const removeOverlappingOwnership = async (root: string): Promise<void> => {
  for (const project of ["alpha", "beta"]) {
    const path = join(root, `packages/${project}/tsconfig.json`);
    const tsconfig = JSON.parse(await readFile(path, "utf8")) as {
      include: string[];
    };
    tsconfig.include = ["src/**/*.ts"];
    await writeFile(path, `${JSON.stringify(tsconfig, null, 2)}\n`, "utf8");
  }
};

const statusPair = (result: {
  readonly id: string;
  readonly status: string;
}) => [result.id, result.status];
