import { describe, expect, it } from "vitest";

import { estimateGeneration } from "../src/cli/generate.js";
import { configSchema } from "../src/config/schema.js";
import { estimateUncachedCost, priceForModel } from "../src/llm/cost.js";

describe("generation cost estimation", () => {
  it("aggregates generation and judge estimates across symbols", () => {
    const config = configSchema.parse({ context: { budgetTokens: 2000 } });
    const estimate = estimateGeneration(config, 10, true);

    expect(estimate).toEqual({
      symbols: 10,
      inputTokens: 51_000,
      outputTokens: 3_800,
      costUsd: 0.108,
      includesJudge: true,
    });
  });

  it("omits unknown prices instead of reporting zero cost", () => {
    const config = configSchema.parse({
      generate: { model: "custom-model" },
      judge: { enabled: false },
    });

    expect(estimateGeneration(config, 2, false).costUsd).toBeUndefined();
    expect(priceForModel("custom-model")).toBeUndefined();
    expect(estimateUncachedCost("custom-model", 100, 10)).toBeUndefined();
  });
});
