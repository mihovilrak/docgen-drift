import { conservativeTokenCount, type TokenCount } from "../core/budget.js";
import type { LlmProvider } from "./client.js";

/**
 * Counts context tokens with the provider's own tokenizer when it ships one.
 * Providers that only offer a remote or async token count deliberately leave
 * `countTokens` undefined: budget assembly is synchronous and per candidate, so
 * the conservative estimate is used instead of a network round trip per span.
 */
export const tokenCounter = (
  provider: LlmProvider,
  model: string,
): TokenCount => {
  const count = provider.countTokens?.bind(provider);
  return count === undefined
    ? conservativeTokenCount
    : (text) => count(text, model);
};
