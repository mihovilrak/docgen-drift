import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CONFIG_SCHEMA_URL, runInit } from "../src/cli/init.js";
import { ConfigError, loadConfig } from "../src/config/load.js";

describe("init", () => {
  it("writes a schema-linked config from interactive answers", async () => {
    const root = await mkdtemp(join(tmpdir(), "docgen-init-"));
    const answers = [
      "packages/*/tsconfig.json, apps/*/tsconfig.json",
      "perProject",
      "2",
    ];
    const result = await runInit(root, {
      ask: () => Promise.resolve(answers.shift() ?? ""),
    });

    expect(result.projects).toEqual([
      "packages/*/tsconfig.json",
      "apps/*/tsconfig.json",
    ]);
    expect(JSON.parse(await readFile(result.path, "utf8"))).toEqual({
      $schema: CONFIG_SCHEMA_URL,
      workspace: {
        projects: ["packages/*/tsconfig.json", "apps/*/tsconfig.json"],
        lockfile: "perProject",
        projectConcurrency: 2,
      },
    });
    await expect(loadConfig(root)).resolves.toMatchObject({
      workspace: { lockfile: "perProject", projectConcurrency: 2 },
    });
  });

  it("uses safe defaults and refuses to overwrite a config", async () => {
    const root = await mkdtemp(join(tmpdir(), "docgen-init-default-"));
    const prompt = { ask: () => Promise.resolve("") };
    const result = await runInit(root, prompt);

    expect(result.projects).toEqual(["tsconfig.json"]);
    await expect(runInit(root, prompt)).rejects.toBeInstanceOf(ConfigError);
    await writeFile(result.path, "{}\n", "utf8");
    expect(await readFile(result.path, "utf8")).toBe("{}\n");
  });

  it("rejects invalid interactive values before writing", async () => {
    const root = await mkdtemp(join(tmpdir(), "docgen-init-invalid-"));
    const answers = ["tsconfig.json", "shared", "zero"];

    await expect(
      runInit(root, { ask: () => Promise.resolve(answers.shift() ?? "") }),
    ).rejects.toThrow("positive integer");
  });
});
