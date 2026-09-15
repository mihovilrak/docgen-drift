import type { ProviderConfig } from "../../config/provider.js";
import { ConfigError } from "../../config/load.js";
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  FALLBACK_CONTEXT_WINDOW_TOKENS,
  pricedCapabilities,
  type ModelCapabilities,
} from "../capabilities.js";
import type { LlmProvider } from "../client.js";
import {
  ANTHROPIC_CONTEXT_WINDOW_TOKENS,
  AnthropicProvider,
  anthropicPrice,
} from "./anthropic.js";
import {
  CLI_CONTEXT_WINDOW_TOKENS,
  CliTransportProvider,
} from "./cliTransport.js";
import {
  GOOGLE_CONTEXT_WINDOW_TOKENS,
  GoogleProvider,
  googlePrice,
} from "./google.js";
import {
  OPENAI_CONTEXT_WINDOW_TOKENS,
  createOpenAiProvider,
  openaiPrice,
} from "./openai.js";
import { OpenAiCompatibleProvider } from "./openaiCompatible.js";

export type Env = Readonly<Record<string, string | undefined>>;

export interface ProviderStatus {
  readonly id: string;
  readonly kind: ProviderConfig["kind"];
  /** `external` means authentication lives in a user-installed CLI docgen never inspects. */
  readonly credentials: "present" | "missing" | "external" | "none";
  readonly detail: string;
}

export const providerId = (config: ProviderConfig): string =>
  config.kind === "cli" ? `cli:${config.tool}` : config.kind;

export const providerStatus = (
  config: ProviderConfig,
  env: Env = process.env,
): ProviderStatus => {
  const id = providerId(config);
  if (config.kind === "cli") {
    return {
      id,
      kind: config.kind,
      credentials: "external",
      detail: `${config.command ?? config.tool} must already be installed and signed in; docgen never reads credential files`,
    };
  }
  if (config.kind === "openai-compatible" && config.apiKeyEnv === undefined) {
    return {
      id,
      kind: config.kind,
      credentials: "none",
      detail: `${config.baseUrl} (no API key configured)`,
    };
  }
  const variable = config.apiKeyEnv;
  const present = variable !== undefined && (env[variable] ?? "") !== "";
  return {
    id,
    kind: config.kind,
    credentials: present ? "present" : "missing",
    detail: `${variable ?? "An API key"} is ${present ? "" : "not "}set`,
  };
};

export const createProvider = (
  config: ProviderConfig,
  env: Env = process.env,
): LlmProvider => {
  switch (config.kind) {
    case "anthropic":
      return new AnthropicProvider({
        apiKey: requireKey(config.apiKeyEnv, env, "anthropic"),
        ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
        maxOutputTokens: config.maxOutputTokens,
      });
    case "openai":
      return createOpenAiProvider({
        apiKey: requireKey(config.apiKeyEnv, env, "openai"),
        baseUrl: config.baseUrl,
        maxOutputTokens: config.maxOutputTokens,
      });
    case "google":
      return new GoogleProvider({
        apiKey: requireKey(config.apiKeyEnv, env, "google"),
        baseUrl: config.baseUrl,
        maxOutputTokens: config.maxOutputTokens,
      });
    case "openai-compatible":
      return new OpenAiCompatibleProvider({
        id: "openai-compatible",
        baseUrl: config.baseUrl,
        ...(config.apiKeyEnv === undefined
          ? {}
          : { apiKey: requireKey(config.apiKeyEnv, env, "openai-compatible") }),
        ...(config.contextWindowTokens === undefined
          ? {}
          : { contextWindowTokens: config.contextWindowTokens }),
        maxOutputTokens: config.maxOutputTokens,
        timeoutMs: config.timeoutMs,
      });
    case "cli":
      return new CliTransportProvider({
        tool: config.tool,
        ...(config.command === undefined ? {} : { command: config.command }),
        args: config.args,
        timeoutMs: config.timeoutMs,
      });
  }
};

const requireKey = (variable: string, env: Env, provider: string): string => {
  const value = env[variable];
  if (value === undefined || value === "") {
    throw new ConfigError(
      `Provider ${provider} requires ${variable} to be set in the environment`,
    );
  }
  return value;
};

/**
 * Model limits and price without constructing a provider, so estimates and the
 * `providers` command work with no credentials present.
 */
export const providerCapabilities = (
  config: ProviderConfig,
  model: string,
): ModelCapabilities => {
  switch (config.kind) {
    case "anthropic":
      return pricedCapabilities(
        model,
        ANTHROPIC_CONTEXT_WINDOW_TOKENS,
        config.maxOutputTokens,
        anthropicPrice(model),
      );
    case "openai":
      return pricedCapabilities(
        model,
        OPENAI_CONTEXT_WINDOW_TOKENS,
        config.maxOutputTokens,
        openaiPrice(model),
      );
    case "google":
      return pricedCapabilities(
        model,
        GOOGLE_CONTEXT_WINDOW_TOKENS,
        config.maxOutputTokens,
        googlePrice(model),
      );
    case "openai-compatible":
      return pricedCapabilities(
        model,
        config.contextWindowTokens ?? FALLBACK_CONTEXT_WINDOW_TOKENS,
        config.maxOutputTokens,
        undefined,
      );
    case "cli":
      return {
        model,
        contextWindowTokens: CLI_CONTEXT_WINDOW_TOKENS,
        maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
        structuredOutput: false,
        costBasis: "subscription",
      };
  }
};
