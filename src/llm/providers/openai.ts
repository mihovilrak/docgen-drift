import type { ModelPrice } from "../capabilities.js";
import {
  OpenAiCompatibleProvider,
  type OpenAiCompatibleOptions,
} from "./openaiCompatible.js";

export const OPENAI_BASE_URL = "https://api.openai.com/v1";
export const OPENAI_CONTEXT_WINDOW_TOKENS = 400_000;

const PRICES: readonly (readonly [string, ModelPrice])[] = [
  ["gpt-5-mini", { inputUsdPerMillion: 0.25, outputUsdPerMillion: 2 }],
  ["gpt-5-nano", { inputUsdPerMillion: 0.05, outputUsdPerMillion: 0.4 }],
  ["gpt-5", { inputUsdPerMillion: 1.25, outputUsdPerMillion: 10 }],
  ["gpt-4.1-mini", { inputUsdPerMillion: 0.4, outputUsdPerMillion: 1.6 }],
  ["gpt-4.1", { inputUsdPerMillion: 2, outputUsdPerMillion: 8 }],
  ["o4-mini", { inputUsdPerMillion: 1.1, outputUsdPerMillion: 4.4 }],
];

export const openaiPrice = (model: string): ModelPrice | undefined =>
  PRICES.find(([name]) => model.startsWith(name))?.[1];

export type OpenAiProviderOptions = Omit<
  OpenAiCompatibleOptions,
  "id" | "baseUrl" | "price"
> & { readonly baseUrl?: string };

export const createOpenAiProvider = (
  options: OpenAiProviderOptions = {},
): OpenAiCompatibleProvider =>
  new OpenAiCompatibleProvider({
    ...options,
    id: "openai",
    baseUrl: options.baseUrl ?? OPENAI_BASE_URL,
    contextWindowTokens:
      options.contextWindowTokens ?? OPENAI_CONTEXT_WINDOW_TOKENS,
    maxTokensField: "max_completion_tokens",
    price: openaiPrice,
  });
