import { z } from "zod";

import { providerSchema } from "./provider.js";

const workspaceSchema = z
  .object({
    projects: z.array(z.string()).min(1).default(["tsconfig.json"]),
    lockfile: z.enum(["shared", "perProject"]).default("shared"),
    projectConcurrency: z.number().int().positive().default(1),
  })
  .strict();

const symbolsSchema = z
  .object({
    kinds: z
      .array(
        z.enum([
          "function",
          "arrow",
          "method",
          "accessor",
          "class",
          "interface",
          "typeAlias",
          "enum",
          "variable",
        ]),
      )
      .default([
        "function",
        "arrow",
        "method",
        "accessor",
        "class",
        "interface",
        "typeAlias",
        "enum",
      ]),
    exportedOnly: z.boolean().default(true),
    publicSurface: z
      .enum(["syntacticExports", "entryPoints"])
      .default("syntacticExports"),
    entryPoints: z.array(z.string()).default(["src/index.ts"]),
    visibility: z
      .array(z.enum(["public", "protected", "private", "package"]))
      .default(["public"]),
    minBodyLines: z.number().int().nonnegative().default(3),
    ignorePragmas: z.array(z.string()).default(["@docgen-ignore", "@internal"]),
  })
  .strict();

const leadingCommentsSchema = z
  .object({
    includeInContext: z.boolean().default(true),
    onGenerate: z.enum(["preserve", "replace"]).default("preserve"),
  })
  .strict();

const docsSchema = z
  .object({
    style: z.literal("jsdoc").default("jsdoc"),
    granularity: z
      .enum(["minimal", "standard", "detailed"])
      .default("standard"),
    emitTypes: z.boolean().default(false),
    leadingComments: leadingCommentsSchema.prefault({}),
    tags: z
      .object({
        params: z.boolean().default(true),
        returns: z.boolean().default(true),
        throws: z.boolean().default(true),
        example: z.boolean().default(false),
      })
      .strict()
      .prefault({}),
    preserveTags: z
      .array(z.string())
      .default([
        "deprecated",
        "example",
        "see",
        "internal",
        "since",
        "template",
      ]),
    lineWidth: z.number().int().min(40).default(80),
    maxLineWidth: z.number().int().min(40).default(90),
  })
  .strict();

const contextSchema = z
  .object({
    budgetTokens: z.number().int().positive().default(2000),
    sources: z
      .object({
        testNames: z.boolean().default(true),
        ownBody: z.boolean().default(true),
        callSites: z.boolean().default(true),
        calleeSummaries: z.boolean().default(true),
        referencedTypes: z.boolean().default(true),
        gitSubject: z.boolean().default(true),
        calleeBodies: z.boolean().default(false),
      })
      .strict()
      .prefault({}),
    callSites: z
      .object({
        max: z.number().int().nonnegative().default(5),
        lines: z.number().int().nonnegative().default(2),
        sampling: z
          .enum(["moduleDiversity", "first"])
          .default("moduleDiversity"),
      })
      .strict()
      .prefault({}),
    bodyMaxLines: z.number().int().positive().default(120),
    shared: z
      .object({
        enabled: z.boolean().default(true),
        budgetTokens: z.number().int().positive().default(1200),
        minSymbols: z.number().int().min(2).default(2),
      })
      .strict()
      .prefault({}),
    git: z
      .object({ timeoutMs: z.number().int().positive().default(2000) })
      .strict()
      .prefault({}),
  })
  .strict();

const generateSchema = z
  .object({
    provider: providerSchema.prefault({ kind: "anthropic" }),
    model: z.string().default("claude-sonnet-5"),
    concurrency: z.number().int().positive().default(8),
    maxSymbolsPerRun: z.number().int().positive().default(500),
  })
  .strict();

const judgeSchema = z
  .object({
    enabled: z.boolean().default(true),
    /** Defaults to generate.provider so a single-provider config stays short. */
    provider: providerSchema.optional(),
    model: z.string().default("claude-haiku-4-5-20251001"),
    strictLeaves: z.boolean().default(true),
  })
  .strict();

const checkSchema = z
  .object({
    reportMissing: z.boolean().default(false),
    reportOrphaned: z.boolean().default(true),
  })
  .strict();

export const configSchema = z
  .object({
    $schema: z.string().optional(),
    include: z.array(z.string()).default(["src/**/*.ts", "src/**/*.tsx"]),
    exclude: z
      .array(z.string())
      .default([
        "**/*.d.ts",
        "**/node_modules/**",
        "**/dist/**",
        "**/build/**",
        "**/coverage/**",
      ]),
    tests: z
      .array(z.string())
      .default([
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.spec.ts",
        "**/*.spec.tsx",
        "**/__tests__/**",
      ]),
    workspace: workspaceSchema.prefault({}),
    symbols: symbolsSchema.prefault({}),
    docs: docsSchema.prefault({}),
    check: checkSchema.prefault({}),
    context: contextSchema.prefault({}),
    generate: generateSchema.prefault({}),
    judge: judgeSchema.prefault({}),
  })
  .strict()
  .superRefine((config, context) => {
    if (
      config.docs.leadingComments.onGenerate === "replace" &&
      !config.judge.enabled
    ) {
      context.addIssue({
        code: "custom",
        path: ["judge", "enabled"],
        message: "must be true when docs.leadingComments.onGenerate is replace",
      });
    }
    if (config.docs.maxLineWidth < config.docs.lineWidth) {
      context.addIssue({
        code: "custom",
        path: ["docs", "maxLineWidth"],
        message: "must be greater than or equal to docs.lineWidth",
      });
    }
    if (
      config.symbols.publicSurface === "entryPoints" &&
      config.symbols.entryPoints.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["symbols", "entryPoints"],
        message:
          "must list at least one entry point when publicSurface is entryPoints",
      });
    }
  });

export type ProviderConfig = z.infer<typeof providerSchema>;

export const judgeProviderConfig = (config: DocgenConfig): ProviderConfig =>
  config.judge.provider ?? config.generate.provider;

export type DocgenConfig = z.infer<typeof configSchema>;

interface SourceNoteOwner {
  readonly existingDoc: unknown;
  readonly sourceNote: { readonly replacementEligible: boolean } | null;
}

/**
 * Decide whether a symbol's leading source note should be replaced by the
 * generated documentation comment.
 * @param config Docgen configuration; replacement applies only when its
 *   leading-comments onGenerate setting is "replace".
 * @param symbol Symbol to check; it must have no existing doc comment and a
 *   source note marked as eligible for replacement.
 * @returns true when the configuration and symbol state both call for the
 *   source note to be replaced, otherwise false.
 */
export const replacesSourceNote = (
  config: DocgenConfig,
  symbol: SourceNoteOwner,
): boolean =>
  config.docs.leadingComments.onGenerate === "replace" &&
  symbol.existingDoc === null &&
  symbol.sourceNote?.replacementEligible === true;
