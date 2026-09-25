import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { configSchema, judgeProviderConfig } from "../src/config/schema.js";
import { runBaseline, runCheck } from "../src/cli/run.js";
import { runGeneration } from "../src/cli/generate.js";

describe("tutorial examples", () => {
  it("configures compatible judge models in direct API examples", async () => {
    const source = await readFile(resolve("docs/providers.md"), "utf8");
    const blocks = [...source.matchAll(/```json\n([\s\S]*?)\n```/gu)].slice(
      0,
      3,
    );
    expect(blocks).toHaveLength(3);
    for (const block of blocks) {
      const config = configSchema.parse(JSON.parse(block[1] ?? ""));
      const provider = judgeProviderConfig(config);
      if (provider.kind === "openai")
        expect(config.judge.model).toBe("gpt-5-mini");
      if (provider.kind === "google")
        expect(config.judge.model).toBe("gemini-3.6-flash");
    }
  });

  it("walks through preview, apply, baseline, and deliberate drift with a stub", async () => {
    const root = await mkdtemp(join(tmpdir(), "docgen-tutorial-"));
    await cp(resolve("test/fixtures/generation"), root, { recursive: true });
    const page = await readFile(
      resolve("docs/tutorial/01-install-and-scope.md"),
      "utf8",
    );
    const source = /```ts\n([\s\S]*?)\n```/u.exec(page)?.[1];
    if (source === undefined) throw new Error("Missing example");
    const path = join(root, "src/public-api.ts");
    await writeFile(path, `${source}\n`, "utf8");
    const config = configSchema.parse({
      include: ["src/public-api.ts"],
      symbols: { minBodyLines: 0 },
      context: { sources: { gitSubject: false } },
    });
    const id = "src/public-api.ts#highestScore";
    let calls = 0;
    const provider = {
      id: "tutorial-stub",
      isRetryable: () => false,
      complete: () => {
        const judgment = calls++ % 2 === 1;
        return Promise.resolve({
          value: judgment
            ? {
                id,
                verdict: "ACCEPT",
                reason: "Explains the empty-input fallback.",
              }
            : {
                id,
                verdict: "OK",
                detail: null,
                reason: null,
                summary:
                  "Return the highest score, or zero when no scores are available.",
                params: { scores: "Scores to compare." },
                returns: "The maximum score, or zero for empty input.",
                throws: [],
              },
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            costBasis: "none" as const,
          },
        });
      },
    };
    expect((await runCheck(root, config)).results[0]?.status).toBe("missing");
    const preview = await runGeneration(
      root,
      config,
      { mode: "missing", path: "src/public-api.ts", dryRun: true },
      provider,
    );
    expect(preview.generated).toEqual([id]);
    expect(await readFile(path, "utf8")).toBe(`${source}\n`);
    const applied = await runGeneration(
      root,
      config,
      { mode: "missing", path: "src/public-api.ts", allowDirty: true },
      provider,
    );
    expect(applied.generated).toEqual([id]);
    expect(calls).toBe(4);
    await runBaseline(root, config);
    expect((await runCheck(root, config)).results[0]?.status).toBe("unchanged");
    const documented = await readFile(path, "utf8");
    await writeFile(
      path,
      documented.replace("return 0;", "return -1;"),
      "utf8",
    );
    expect(
      (await runCheck(root, config)).results.map((result) => result.status),
    ).toEqual(["drifted"]);
  });
});
