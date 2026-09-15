import { ConfigError } from "../config/load.js";
import { providerSchema, type ProviderConfig } from "../config/provider.js";
import type { DocgenConfig } from "../config/schema.js";

export interface GenerationOverrides {
  readonly provider?: string;
  readonly model?: string;
}

const OVERRIDE_FORMS =
  "anthropic, openai, google, or cli:<claude|codex|gemini|opencode|pi>";

/**
 * `openai-compatible` is deliberately not expressible here: it needs a base URL
 * and credential variable that only configuration can supply.
 */
export const parseProviderOverride = (value: string): ProviderConfig => {
  if (value === "openai-compatible") {
    throw new ConfigError(
      "--provider openai-compatible requires a configured baseUrl; set generate.provider in .docgenrc.json instead",
    );
  }
  const shape = value.startsWith("cli:")
    ? { kind: "cli", tool: value.slice(4) }
    : { kind: value };
  const parsed = providerSchema.safeParse(shape);
  if (!parsed.success) {
    throw new ConfigError(
      `Unknown --provider ${value}; expected ${OVERRIDE_FORMS}`,
    );
  }
  return parsed.data;
};

/**
 * Per-run overrides apply to generation only. The judge keeps the provider it
 * already resolved to, so `--provider` never silently moves a judge model onto
 * a service that does not host it.
 */
export const applyGenerationOverrides = (
  config: DocgenConfig,
  overrides: GenerationOverrides,
): DocgenConfig => {
  if (overrides.provider === undefined && overrides.model === undefined) {
    return config;
  }
  const provider =
    overrides.provider === undefined
      ? config.generate.provider
      : parseProviderOverride(overrides.provider);
  return {
    ...config,
    generate: {
      ...config.generate,
      provider,
      model: overrides.model ?? config.generate.model,
    },
    judge: {
      ...config.judge,
      provider: config.judge.provider ?? config.generate.provider,
    },
  };
};
