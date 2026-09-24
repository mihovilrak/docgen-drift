import { z } from "zod";

const DEFAULT_TIMEOUT_MS = 120_000;

/** Client-side pacing for rate-limited tiers; the daily count is per run, not persisted. */
const rateLimits = {
  requestsPerMinute: z.number().int().positive().optional(),
  requestsPerDay: z.number().int().positive().optional(),
};

const anthropicProviderSchema = z
  .object({
    kind: z.literal("anthropic"),
    ...rateLimits,
    apiKeyEnv: z.string().min(1).default("ANTHROPIC_API_KEY"),
    baseUrl: z.string().min(1).optional(),
    maxOutputTokens: z.number().int().positive().default(1200),
  })
  .strict();

const openaiProviderSchema = z
  .object({
    kind: z.literal("openai"),
    ...rateLimits,
    apiKeyEnv: z.string().min(1).default("OPENAI_API_KEY"),
    baseUrl: z.string().min(1).default("https://api.openai.com/v1"),
    maxOutputTokens: z.number().int().positive().default(1200),
  })
  .strict();

const googleProviderSchema = z
  .object({
    kind: z.literal("google"),
    ...rateLimits,
    apiKeyEnv: z.string().min(1).default("GEMINI_API_KEY"),
    baseUrl: z
      .string()
      .min(1)
      .default("https://generativelanguage.googleapis.com/v1beta"),
    maxOutputTokens: z.number().int().positive().default(1200),
  })
  .strict();

const openaiCompatibleProviderSchema = z
  .object({
    kind: z.literal("openai-compatible"),
    ...rateLimits,
    baseUrl: z.string().min(1),
    apiKeyEnv: z.string().min(1).optional(),
    contextWindowTokens: z.number().int().positive().optional(),
    maxOutputTokens: z.number().int().positive().default(1200),
    timeoutMs: z.number().int().positive().default(DEFAULT_TIMEOUT_MS),
  })
  .strict();

const cliProviderSchema = z
  .object({
    kind: z.literal("cli"),
    ...rateLimits,
    tool: z.enum(["claude", "codex", "gemini", "opencode", "pi"]),
    command: z.string().min(1).optional(),
    args: z.array(z.string()).default([]),
    timeoutMs: z.number().int().positive().default(DEFAULT_TIMEOUT_MS),
  })
  .strict();

export const providerSchema = z.discriminatedUnion("kind", [
  anthropicProviderSchema,
  openaiProviderSchema,
  googleProviderSchema,
  openaiCompatibleProviderSchema,
  cliProviderSchema,
]);

export type ProviderConfig = z.infer<typeof providerSchema>;
export type ProviderKind = ProviderConfig["kind"];
export const PROVIDER_KINDS: readonly ProviderKind[] = [
  "anthropic",
  "openai",
  "google",
  "openai-compatible",
  "cli",
];
