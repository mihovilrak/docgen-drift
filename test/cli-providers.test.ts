import { describe, expect, it } from "vitest";

import {
  inspectProviders,
  preflightProviders,
  renderPreflight,
  renderProviders,
} from "../src/cli/inspect.js";
import {
  applyGenerationOverrides,
  parseProviderOverride,
} from "../src/cli/overrides.js";
import { ConfigError } from "../src/config/load.js";
import { configSchema } from "../src/config/schema.js";

const config = (overrides: Record<string, unknown> = {}) =>
  configSchema.parse(overrides);

describe("provider overrides", () => {
  it("accepts every documented direct and CLI form", () => {
    expect(parseProviderOverride("anthropic")).toMatchObject({
      kind: "anthropic",
      apiKeyEnv: "ANTHROPIC_API_KEY",
    });
    expect(parseProviderOverride("openai")).toMatchObject({ kind: "openai" });
    expect(parseProviderOverride("google")).toMatchObject({ kind: "google" });
    expect(parseProviderOverride("cli:claude")).toMatchObject({
      kind: "cli",
      tool: "claude",
    });
  });

  it("rejects openai-compatible and unknown ids", () => {
    expect(() => parseProviderOverride("openai-compatible")).toThrow(
      /requires a configured baseUrl/u,
    );
    expect(() => parseProviderOverride("cli:vim")).toThrow(ConfigError);
    expect(() => parseProviderOverride("llama")).toThrow(
      /expected anthropic, openai, google, or cli:/u,
    );
  });

  it("returns the config untouched when nothing is overridden", () => {
    const base = config();
    expect(applyGenerationOverrides(base, {})).toBe(base);
  });

  it("overrides generation only and pins the judge to its previous provider", () => {
    const result = applyGenerationOverrides(config(), {
      provider: "openai",
      model: "gpt-5",
    });

    expect(result.generate.provider.kind).toBe("openai");
    expect(result.generate.model).toBe("gpt-5");
    expect(result.judge.provider?.kind).toBe("anthropic");
    expect(result.judge.model).toBe("claude-haiku-4-5-20251001");
  });

  it("keeps an explicitly configured judge provider", () => {
    const result = applyGenerationOverrides(
      config({ judge: { provider: { kind: "google" } } }),
      { provider: "openai" },
    );

    expect(result.judge.provider?.kind).toBe("google");
  });

  it("overrides the model without changing the provider", () => {
    const result = applyGenerationOverrides(config(), { model: "custom" });

    expect(result.generate.provider.kind).toBe("anthropic");
    expect(result.generate.model).toBe("custom");
  });
});

describe("provider inspection", () => {
  it("reports models, limits and credential names without reading credentials", () => {
    const [generate, judge] = inspectProviders(config(), {
      ANTHROPIC_API_KEY: "sk-test",
    });

    expect(generate).toMatchObject({
      role: "generate",
      enabled: true,
      model: "claude-sonnet-5",
      status: { id: "anthropic", credentials: "present" },
    });
    expect(generate?.capabilities.contextWindowTokens).toBe(200_000);
    expect(generate?.capabilities.costBasis).toBe("usd");
    expect(judge).toMatchObject({ role: "judge", enabled: true });
    expect(judge?.config).toEqual(generate?.config);
  });

  it("reports a missing key as missing rather than failing", () => {
    const [generate] = inspectProviders(config(), {});

    expect(generate?.status.credentials).toBe("missing");
    expect(generate?.status.detail).toBe("ANTHROPIC_API_KEY is not set");
    expect(renderProviders(inspectProviders(config(), {}))).toContain(
      "credentials missing",
    );
  });

  it("never claims to inspect CLI credential files", () => {
    const [generate] = inspectProviders(
      config({ generate: { provider: { kind: "cli", tool: "claude" } } }),
      {},
    );

    expect(generate?.status.credentials).toBe("external");
    expect(generate?.status.detail).toContain("never reads credential files");
    expect(generate?.capabilities.costBasis).toBe("subscription");
    expect(generate?.capabilities.price).toBeUndefined();
  });

  it("marks a disabled judge but still describes it", () => {
    const inspections = inspectProviders(
      config({ judge: { enabled: false } }),
      {
        ANTHROPIC_API_KEY: "sk-test",
      },
    );

    expect(inspections[1]?.enabled).toBe(false);
    expect(renderProviders(inspections)).toContain("(disabled)");
  });
});

describe("authentication preflight", () => {
  it("passes when the environment variable is set and fails when it is not", async () => {
    const env = { ANTHROPIC_API_KEY: "sk-test" };

    await expect(
      preflightProviders(inspectProviders(config(), env), env),
    ).resolves.toEqual([
      {
        role: "generate",
        id: "anthropic",
        ok: true,
        detail: "ANTHROPIC_API_KEY is set",
      },
      {
        role: "judge",
        id: "anthropic",
        ok: true,
        detail: "ANTHROPIC_API_KEY is set",
      },
    ]);

    const missing = await preflightProviders(
      inspectProviders(config(), {}),
      {},
    );
    expect(missing.every((result) => result.ok)).toBe(false);
    expect(renderPreflight(missing)).toContain("failed");
  });

  it("skips a disabled judge", async () => {
    const env = { ANTHROPIC_API_KEY: "sk-test" };
    const results = await preflightProviders(
      inspectProviders(config({ judge: { enabled: false } }), env),
      env,
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.role).toBe("generate");
  });

  it("checks only PATH for a CLI transport", async () => {
    const cliConfig = config({
      generate: {
        provider: {
          kind: "cli",
          tool: "claude",
          command: "docgen-no-such-cli",
        },
      },
      judge: { enabled: false },
    });
    const results = await preflightProviders(inspectProviders(cliConfig, {}), {
      PATH: "",
    });

    expect(results[0]).toEqual({
      role: "generate",
      id: "cli:claude",
      ok: false,
      detail: "docgen-no-such-cli is not installed or not on PATH",
    });
  });
});
