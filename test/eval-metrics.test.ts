import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ablationMetrics,
  commentPromotionMetrics,
  judgeMetrics,
} from "../src/eval/metrics.js";

describe("Phase 5 evaluation metrics", () => {
  it("measures keep, false-keep, and false-reject rates", () => {
    expect(
      judgeMetrics([
        { humanUseful: true, judgeVerdict: "ACCEPT" },
        { humanUseful: false, judgeVerdict: "ACCEPT" },
        { humanUseful: true, judgeVerdict: "REJECT" },
        { humanUseful: false, judgeVerdict: "REJECT" },
      ]),
    ).toEqual({
      total: 4,
      kept: 2,
      keepRate: 0.5,
      falseKeeps: 1,
      falseKeepRate: 0.5,
      falseRejects: 1,
      falseRejectRate: 0.5,
    });
  });

  it("compares signature-only and full-context quality", () => {
    expect(
      ablationMetrics([
        { signatureOnlyScore: 1, fullContextScore: 4 },
        { signatureOnlyScore: 2, fullContextScore: 4 },
      ]),
    ).toEqual({
      total: 2,
      signatureOnlyMean: 1.5,
      fullContextMean: 4,
      meanImprovement: 2.5,
    });
  });

  it("tracks useful intent and unsafe source-note promotion", () => {
    expect(
      commentPromotionMetrics([
        {
          kind: "intent",
          accepted: true,
          retainedUsefulIntent: true,
          safePublicClaim: true,
        },
        {
          kind: "todo",
          accepted: false,
          retainedUsefulIntent: false,
          safePublicClaim: true,
        },
      ]),
    ).toEqual({
      total: 2,
      usefulIntentRetentionRate: 1,
      unsafePromotionRate: 0,
      noiseRejectionRate: 1,
    });
  });

  it("keeps the checked-in evaluation above the Phase 5 thresholds", async () => {
    const data = JSON.parse(
      await readFile(resolve("eval/phase5.json"), "utf8"),
    ) as {
      readonly cases: readonly {
        readonly repository: string;
        readonly humanUseful: boolean;
        readonly judgeVerdict: "ACCEPT" | "REJECT";
        readonly ablation: {
          readonly signatureOnlyScore: number;
          readonly fullContextScore: number;
        };
      }[];
      readonly commentPromotionCases: readonly {
        readonly kind: "intent" | "todo" | "directive" | "implementation";
        readonly accepted: boolean;
        readonly retainedUsefulIntent: boolean;
        readonly safePublicClaim: boolean;
      }[];
    };

    expect(data.cases).toHaveLength(100);
    expect(new Set(data.cases.map((item) => item.repository)).size).toBe(3);
    expect(judgeMetrics(data.cases).falseKeepRate).toBeLessThan(0.1);
    expect(
      ablationMetrics(data.cases.map((item) => item.ablation)),
    ).toMatchObject({ meanImprovement: 2.67 });
    expect(commentPromotionMetrics(data.commentPromotionCases)).toMatchObject({
      usefulIntentRetentionRate: 1,
      unsafePromotionRate: 0,
      noiseRejectionRate: 1,
    });
  });
});
