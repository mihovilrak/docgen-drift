import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DuplicateSourceOwnershipError,
  loadWorkspace,
  resolveWorkspace,
} from "../src/adapters/typescript/loadWorkspace.js";

const fixtureRoot = resolve("test/fixtures/monorepo");

describe("loadWorkspace", () => {
  it("rejects source files claimed by multiple projects", async () => {
    await expect(
      resolveWorkspace({
        root: fixtureRoot,
        projects: ["packages/*/tsconfig.json"],
        projectConcurrency: 2,
      }),
    ).rejects.toBeInstanceOf(DuplicateSourceOwnershipError);
  });

  it("loads isolated projects at the configured concurrency", async () => {
    let active = 0;
    let peak = 0;
    const results = await loadWorkspace(
      {
        root: fixtureRoot,
        projects: ["tsconfig.*.json"],
        projectConcurrency: 2,
      },
      async (project) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
        active--;
        return project.sourceFiles.map((file) => file.getBaseName());
      },
    );

    expect(peak).toBe(2);
    expect(results).toEqual([["index.ts"], ["index.ts"]]);
  });

  it("defaults project loading to one active compiler program", async () => {
    let active = 0;
    let peak = 0;
    await loadWorkspace(
      { root: fixtureRoot, projects: ["tsconfig.*.json"] },
      async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
        active--;
      },
    );

    expect(peak).toBe(1);
  });
});
