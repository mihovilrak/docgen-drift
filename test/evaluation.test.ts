import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { writeEvaluationArtifact } from "../src/cli/evaluation.js";

describe("generation evaluation artifact", () => {
  it("creates parent directories and writes parseable JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "docgen-evaluation-"));
    const path = join(root, "nested", "run.json");

    await writeEvaluationArtifact(path, {
      schemaVersion: 1,
      createdAt: "2026-09-16T00:00:00.000Z",
      mode: "missing",
      dryRun: true,
      promptVersion: "2:1",
      outputPolicy: {
        granularity: "standard",
        detail: false,
        params: true,
        returns: true,
        throws: false,
        replacedNote: null,
      },
      providers: {
        generation: { id: "stub", model: "stub-model" },
      },
      metrics: {
        durationMs: 4,
        generation: {
          requests: 1,
          attempts: 1,
          candidates: 1,
          skipped: 0,
          failed: 0,
          durationMs: 2,
        },
        judge: {
          requests: 0,
          attempts: 0,
          accepted: 0,
          rejected: 0,
          failed: 0,
          durationMs: 0,
        },
      },
      usage: {
        inputTokens: 2,
        outputTokens: 1,
        costBasis: "subscription",
        tokenCountsAvailable: false,
      },
      records: [],
    });

    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      schemaVersion: 1,
      promptVersion: "2:1",
      metrics: { generation: { requests: 1 } },
      records: [],
    });
  });
});
