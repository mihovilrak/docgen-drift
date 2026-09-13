import { ConfigError } from "../../config/load.js";
import type { LlmProvider } from "../client.js";
import { AnthropicProvider } from "./anthropic.js";

export const createProvider = (provider: string): LlmProvider => {
  if (provider === "anthropic") return new AnthropicProvider();
  throw new ConfigError(
    `Unsupported generation provider ${provider}; available providers: anthropic`,
  );
};
