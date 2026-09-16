import { describe, expect, it } from "vitest";

import { estimateGeneration } from "../src/cli/generate.js";
import { renderEstimate, renderGeneration } from "../src/cli/render.js";
import { configSchema } from "../src/config/schema.js";
import { costFromPrice } from "../src/llm/capabilities.js";
import { anthropicPrice } from "../src/llm/providers/anthropic.js";

describe("generation cost estimation", () => {
  it("aggregates generation and judge estimates across symbols", () => {
    const config = configSchema.parse({ context: { budgetTokens: 2000 } });
    const estimate = estimateGeneration(config, 10, true);

    expect(estimate).toEqual({
      symbols: 10,
      inputTokens: 51_000,
      outputTokens: 3_800,
      costUsd: 0.108,
      costBasis: "usd",
      includesJudge: true,
      contextBudgetTokens: 2000,
      contextBudgetReduced: false,
    });
  });

  it("reports an unknown price as unknown rather than zero", () => {
    const config = configSchema.parse({
      generate: { model: "custom-model" },
      judge: { enabled: false },
    });
    const estimate = estimateGeneration(config, 2, false);

    expect(estimate.costUsd).toBeUndefined();
    expect(estimate.costBasis).toBe("unknown");
    expect(anthropicPrice("custom-model")).toBeUndefined();
    expect(costFromPrice(undefined, 100, 10)).toBeUndefined();
    expect(renderEstimate(estimate)).toContain(
      "cost unavailable for the configured model",
    );
    expect(renderEstimate(estimate)).not.toContain("$");
  });

  it("reports subscription transports as an allowance, not a dollar figure", () => {
    const config = configSchema.parse({
      generate: { provider: { kind: "cli", tool: "claude" } },
      judge: { enabled: false },
    });
    const estimate = estimateGeneration(config, 3, false);

    expect(estimate.costBasis).toBe("subscription");
    expect(estimate.costUsd).toBeUndefined();
    expect(renderEstimate(estimate)).toContain("subscription allowance");
    expect(renderEstimate(estimate)).not.toContain("$");
  });

  it("does not render unavailable CLI token counts as measured zeroes", () => {
    const output = renderGeneration(
      {
        requested: 1,
        generated: ["src/api.ts#leaf"],
        skipped: [],
        rejected: [],
        failed: [],
        changedFiles: 1,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          tokenCountsAvailable: false,
          costBasis: "subscription",
        },
        diff: "",
      },
      true,
    );

    expect(output).toContain(
      "1 generated, 0 skipped, 0 rejected, 0 failed in 1 file; token counts unavailable, subscription allowance",
    );
    expect(output).not.toContain("0 input tokens");
  });

  it("uses singular wording for a one-symbol estimate", () => {
    const estimate = estimateGeneration(configSchema.parse({}), 1, false);

    expect(renderEstimate(estimate)).toContain("for 1 symbol:");
  });

  it("reduces an oversized context budget to the configured model window", () => {
    const config = configSchema.parse({
      context: { budgetTokens: 20_000 },
      generate: {
        provider: {
          kind: "openai-compatible",
          baseUrl: "http://localhost:11434/v1",
          contextWindowTokens: 8192,
          maxOutputTokens: 1200,
        },
      },
      judge: { enabled: false },
    });
    const estimate = estimateGeneration(config, 1, false);

    expect(estimate.contextBudgetTokens).toBe(6480);
    expect(estimate.contextBudgetReduced).toBe(true);
    expect(renderEstimate(estimate)).toContain(
      "Context budget reduced to 6480 tokens",
    );
  });

  it("also fits context to a smaller judge model window", () => {
    const config = configSchema.parse({
      context: { budgetTokens: 20_000 },
      generate: {
        provider: {
          kind: "openai-compatible",
          baseUrl: "http://localhost:11434/v1",
          contextWindowTokens: 32768,
        },
      },
      judge: {
        provider: {
          kind: "openai-compatible",
          baseUrl: "http://localhost:1234/v1",
          contextWindowTokens: 8192,
        },
      },
    });

    expect(estimateGeneration(config, 1, true).contextBudgetTokens).toBe(6480);
  });
});
