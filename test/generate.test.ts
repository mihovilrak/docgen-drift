import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { runGeneration } from "../src/cli/generate.js";
import { scopeProjects } from "../src/cli/projectScope.js";
import { runCheck } from "../src/cli/run.js";
import { ConfigError } from "../src/config/load.js";
import { configSchema, type DocgenConfig } from "../src/config/schema.js";
import type { LlmProvider, ProviderRequest } from "../src/llm/client.js";

const execFileAsync = promisify(execFile);
const fixtureRoot = resolve("test/fixtures/generation");

describe("generation commands", () => {
  it("produces a byte-identical unified dry-run diff without writing", async () => {
    const root = await copyFixture();
    const sourcePath = join(root, "src/api.ts");
    const original = await readFile(sourcePath, "utf8");

    const first = await runGeneration(
      root,
      config(),
      { mode: "missing", path: "src", dryRun: true },
      provider(),
    );
    const second = await runGeneration(
      root,
      config(),
      { mode: "missing", path: "src", dryRun: true },
      provider(),
    );

    expect(first).toEqual(second);
    expect(first).toMatchObject({ requested: 2, changedFiles: 1 });
    expect(first.generated).toHaveLength(2);
    expect(first.diff).toContain("--- a/src/api.ts");
    expect(first.diff).toContain("+++ b/src/api.ts");
    expect(first.diff).toContain("+/**");
    expect(await readFile(sourcePath, "utf8")).toBe(original);
  });

  it("requires path-bounded missing backfill", async () => {
    await expect(
      runGeneration(
        await copyFixture(),
        config(),
        { mode: "missing", dryRun: true },
        provider(),
      ),
    ).rejects.toThrow("requires --path");
  });

  it("refuses a dirty tree unless --allow-dirty is set", async () => {
    const root = await copyFixture();
    await initializeGit(root);
    const sourcePath = join(root, "src/api.ts");
    await writeFile(
      sourcePath,
      `${await readFile(sourcePath, "utf8")}\n// local change\n`,
      "utf8",
    );

    await expect(
      runGeneration(
        root,
        config(),
        { mode: "missing", path: "src" },
        provider(),
      ),
    ).rejects.toBeInstanceOf(ConfigError);

    const result = await runGeneration(
      root,
      config(),
      { mode: "missing", path: "src", allowDirty: true },
      provider(),
    );
    expect(result.generated).toHaveLength(2);
  });

  it("fixes only drifted symbols and keeps skipped drift visible", async () => {
    const root = await copyFixture();
    await runGeneration(
      root,
      config(),
      { mode: "missing", path: "src", allowDirty: true },
      provider(),
    );
    const sourcePath = join(root, "src/api.ts");
    const documented = await readFile(sourcePath, "utf8");
    await writeFile(
      sourcePath,
      documented.replace("value + 1", "value + 2").replace("* 2", "* 3"),
      "utf8",
    );
    const leaf = "src/api.ts#leaf";

    const result = await runGeneration(
      root,
      config(),
      { mode: "drifted", allowDirty: true },
      provider(new Set([leaf])),
    );

    expect(result.requested).toBe(2);
    expect(result.generated).toEqual(["src/api.ts#caller"]);
    expect(result.skipped).toEqual([
      { id: leaf, reason: "Insufficient behavioral context." },
    ]);
    expect(
      Object.fromEntries(
        (await runCheck(root, config())).results.map((item) => [
          item.id,
          item.status,
        ]),
      ),
    ).toEqual({
      "src/api.ts#caller": "unchanged",
      "src/api.ts#leaf": "drifted",
    });
  });

  it("normalizes --project directory, file, and glob scopes", () => {
    const base = config();
    expect(scopeProjects(base, "packages/alpha").workspace.projects).toEqual([
      "packages/alpha/tsconfig.json",
    ]);
    expect(
      scopeProjects(base, "packages/alpha/tsconfig.build.json").workspace
        .projects,
    ).toEqual(["packages/alpha/tsconfig.build.json"]);
    expect(scopeProjects(base, "packages/*").workspace.projects).toEqual([
      "packages/*",
    ]);
  });

  it("exposes fix flags on both CLI entry points", async () => {
    const [check, fix] = await Promise.all([cliHelp("check"), cliHelp("fix")]);

    expect(check).toContain("--fix");
    expect(check).toContain("--project");
    expect(check).toContain("--dry-run");
    expect(check).toContain("--allow-dirty");
    expect(fix).toContain("--missing");
    expect(fix).toContain("--path");
    expect(fix).toContain("--project");
  });
});

const config = (): DocgenConfig =>
  configSchema.parse({
    include: ["src/**/*.ts"],
    tests: [],
    symbols: { minBodyLines: 0 },
    context: { sources: { gitSubject: false } },
  });

const copyFixture = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "docgen-run-generation-"));
  await cp(fixtureRoot, root, { recursive: true });
  return root;
};

const provider = (skips: ReadonlySet<string> = new Set()): LlmProvider => ({
  id: "stub",
  isRetryable: () => false,
  complete: async (request) => {
    const id = idFromPrompt(request);
    const params = paramsFromPrompt(request);
    await Promise.resolve();
    return {
      value: skips.has(id)
        ? {
            id,
            summary: null,
            detail: null,
            params,
            returns: null,
            throws: [],
            verdict: "SKIP",
            reason: "Insufficient behavioral context.",
          }
        : {
            id,
            summary: `Document ${id.slice(id.lastIndexOf("#") + 1)} behavior.`,
            detail: null,
            params,
            returns: "The computed value.",
            throws: [],
            verdict: "OK",
            reason: null,
          },
      usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
    };
  },
});

const idFromPrompt = (request: ProviderRequest): string => {
  const match = request.prompt.match(/id must be exactly ("[^"]+")/u);
  if (match?.[1] === undefined) throw new Error("Missing id in prompt");
  return JSON.parse(match[1]) as string;
};

const paramsFromPrompt = (request: ProviderRequest): Record<string, string> => {
  const match = request.prompt.match(
    /params must contain exactly these keys: (\[[^\n]+\])/u,
  );
  if (match?.[1] === undefined) throw new Error("Missing params in prompt");
  return Object.fromEntries(
    (JSON.parse(match[1]) as string[]).map((name) => [
      name,
      `Document ${name}.`,
    ]),
  );
};

const initializeGit = async (root: string): Promise<void> => {
  await execFileAsync("git", ["init", "--quiet"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.test"], {
    cwd: root,
  });
  await execFileAsync("git", ["config", "user.name", "Docgen Test"], {
    cwd: root,
  });
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "--quiet", "-m", "fixture"], {
    cwd: root,
  });
};

const cliHelp = async (command: "check" | "fix"): Promise<string> => {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", command, "--help"],
    { cwd: process.cwd() },
  );
  return stdout;
};
