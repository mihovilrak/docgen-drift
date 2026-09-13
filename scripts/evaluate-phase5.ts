import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import {
  ablationMetrics,
  commentPromotionMetrics,
  judgeMetrics,
} from "../src/eval/metrics.js";

const caseSchema = z
  .object({
    id: z.string(),
    repository: z.string(),
    commit: z.string(),
    path: z.string(),
    symbol: z.string(),
    signature: z.string(),
    referenceDoc: z.string(),
    candidateDoc: z.string(),
    humanUseful: z.boolean(),
    judgeVerdict: z.enum(["ACCEPT", "REJECT"]),
    judgeReason: z.string(),
    ablation: z
      .object({
        signatureOnlyScore: z.number().min(1).max(5),
        fullContextScore: z.number().min(1).max(5),
      })
      .strict(),
  })
  .strict();

const promotionSchema = z
  .object({
    id: z.string(),
    sourceNote: z.string(),
    generatedDoc: z.string(),
    kind: z.enum(["intent", "todo", "directive", "implementation"]),
    accepted: z.boolean(),
    retainedUsefulIntent: z.boolean(),
    safePublicClaim: z.boolean(),
  })
  .strict();

const evalSchema = z
  .object({
    schemaVersion: z.literal(1),
    reviewedAt: z.string(),
    cases: z.array(caseSchema).length(100),
    commentPromotionCases: z.array(promotionSchema).min(12),
  })
  .strict();

const path = resolve("eval/phase5.json");
const data = evalSchema.parse(JSON.parse(await readFile(path, "utf8")));
const repositories = new Set(data.cases.map((item) => item.repository));
if (repositories.size < 3) {
  throw new Error("Phase 5 evaluation requires at least three repositories");
}

process.stdout.write(
  `${JSON.stringify(
    {
      reviewedAt: data.reviewedAt,
      repositories: [...repositories].sort(),
      judge: judgeMetrics(data.cases),
      ablation: ablationMetrics(data.cases.map((item) => item.ablation)),
      commentPromotion: commentPromotionMetrics(data.commentPromotionCases),
    },
    null,
    2,
  )}\n`,
);
