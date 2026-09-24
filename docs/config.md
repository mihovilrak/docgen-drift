# Configuration

`.docgenrc.json` at the repo root. Every field is optional; the defaults below are what runs when the file is absent. Validated with zod at load — unknown keys are an error, not a warning, because a silently ignored typo in a doc policy is invisible for months.

`docgen init` creates this file interactively and adds the published schema:

```json
{
  "$schema": "https://unpkg.com/docgen-drift@1/schema/docgen.schema.json"
}
```

The same schema is shipped in the npm package at
`schema/docgen.schema.json` for editors that require a local schema path.

## Full default

```jsonc
{
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["**/*.d.ts", "**/node_modules/**", "**/dist/**", "**/build/**", "**/coverage/**"],
  "tests": ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx", "**/__tests__/**"],

  "workspace": {
    "projects": ["tsconfig.json"],
    "lockfile": "shared",
    "projectConcurrency": 1
  },

  "symbols": {
    "kinds": ["function", "arrow", "method", "accessor", "class", "interface", "typeAlias", "enum"],
    "exportedOnly": true,
    "publicSurface": "syntacticExports",
    "entryPoints": ["src/index.ts"],
    "visibility": ["public"],
    "minBodyLines": 3,
    "ignorePragmas": ["@docgen-ignore", "@internal"]
  },

  "docs": {
    "style": "jsdoc",
    "granularity": "standard",
    "emitTypes": false,
    "leadingComments": {
      "includeInContext": true,
      "onGenerate": "preserve"
    },
    "tags": { "params": true, "returns": true, "throws": true, "example": false },
    "preserveTags": ["deprecated", "example", "see", "internal", "since", "template"],
    "lineWidth": 80,
    "maxLineWidth": 90
  },

  "context": {
    "budgetTokens": 2000,
    "sources": {
      "testNames": true,
      "ownBody": true,
      "callSites": true,
      "calleeSummaries": true,
      "referencedTypes": true,
      "gitSubject": true,
      "calleeBodies": false
    },
    "callSites": { "max": 5, "lines": 2, "sampling": "moduleDiversity" },
    "bodyMaxLines": 120,
    "shared": { "enabled": true, "budgetTokens": 1200, "minSymbols": 2 },
    "git": { "timeoutMs": 2000 }
  },

  "generate": {
    "provider": {
      "kind": "anthropic",
      "apiKeyEnv": "ANTHROPIC_API_KEY",
      "maxOutputTokens": 1200
    },
    "model": "claude-sonnet-5",
    "concurrency": 8,
    "maxSymbolsPerRun": 500
  },

  "judge": {
    "enabled": true,
    "model": "claude-haiku-4-5-20251001",
    "strictLeaves": true
  },

  "check": {
    "reportMissing": false,
    "reportOrphaned": true
  }
}
```

## Notes on the non-obvious fields

**`tests`** — these files are read but never documented. Test names are the highest-value non-local context source in the system (see [ADR-006](../DECISIONS.md#adr-006)), so getting this glob right matters more than it looks. If your tests live outside `include`, list them here anyway.

**`workspace.projects`** — one or more `tsconfig.json` paths or globs, relative to the workspace root. Each match is loaded as a separate compiler program. For example, a large monorepo can use `["packages/*/tsconfig.json", "apps/*/tsconfig.json"]`. Duplicate source-file ownership is a configuration error. Use `--project <path-or-glob>` to restrict an individual run.

**`workspace.lockfile`** — `shared` writes one root `.docgen/lock.json` with workspace-relative ids. `perProject` writes a lockfile beside each project and is usually the better choice for independently owned monorepo packages.

**`workspace.projectConcurrency`** — compiler programs resident at once. It defaults to `1` because ts-morph programs are memory-heavy. Increase it only after measuring peak RSS on the target monorepo.

**`symbols.minBodyLines`** — one-line delegating wrappers and pass-through getters almost never earn a docstring. Raising this is the cheapest way to cut noise.

**`symbols.publicSurface`** — `syntacticExports` treats every exported declaration as public. `entryPoints` follows exports and re-exports from `symbols.entryPoints`, including public members of exported classes and interfaces. Use entry-point mode for libraries whose internal modules export symbols for package-internal reuse. An unmatched entry-point pattern is a configuration error.

**`docs.emitTypes`** — off by default and should stay off in TypeScript ([ADR-009](../DECISIONS.md#adr-009)). Turn it on only for plain `.js` without `checkJs`, where the comment is the only carrier of type information.

**`docs.leadingComments.includeInContext`** — includes an attached ordinary `//` group as labelled source-note context for generation. This does not make the comment JSDoc and does not permit its removal.

**`docs.leadingComments.onGenerate`** — `preserve` leaves the original group in place. `replace` atomically replaces an eligible attached group with accepted generated JSDoc when backfilling a missing doc. It requires `judge.enabled: true`, and `--no-judge` is rejected for that run. Replacement never applies to directives, licenses, triple-slash references, trailing or detached comments, body comments, rejected generations, or symbols that already have JSDoc.

**`docs.granularity`**

| Value | Emits |
| --- | --- |
| `minimal` | summary only |
| `standard` | summary, params, returns |
| `detailed` | summary, detail paragraph, params, returns, throws |

`detailed` produces more text, not more information. Use it for a published API surface; `standard` everywhere else.

**`docs.preserveTags`** — tags docgen does not own and must never rewrite or drop when it updates a comment. Add your project's custom tags here before the first `--fix` run, not after.

**`docs.lineWidth` / `docs.maxLineWidth`** — rendered JSDoc is wrapped at `lineWidth` characters, counting indentation and the ` * ` prefix. A paragraph's remaining words may run to `maxLineWidth` instead of starting a short final line. Tag descriptions continue with a two-space indent. Fenced and indented code lines and preserved tags are never reflowed, and a single word longer than the width is not split. Wrapping is deterministic and does not affect prompts or generation.

**`context.budgetTokens`** — per symbol, filled as a ranked knapsack in the order given in [ARCHITECTURE.md](../ARCHITECTURE.md#the-budget). Sources are dropped from the bottom when the budget runs out; disabling a source in `context.sources` removes it entirely regardless of budget.

**`context.shared`** — when a file contributes at least `minSymbols` documented symbols, docgen builds one module outline for that file and sends it as a shared prompt prefix, which Anthropic can cache across the file's requests. The outline is charged against `context.budgetTokens`, not added to it: per-symbol context shrinks by the same amount, and same-file `referencedType` blocks the outline already renders are dropped. `budgetTokens` caps the outline itself. Set `enabled: false` to send fully independent per-symbol requests.

**`context.callSites.sampling`** — `moduleDiversity` picks call sites from as many distinct modules as possible. `first` takes them in discovery order and is only there for reproducible tests; it produces noticeably worse context on hub functions.

**`generate.maxSymbolsPerRun`** — a guard rail, not a performance setting. It exists so that an accidental `fix --missing` at the repo root cannot produce a two-thousand-file diff. Raise it deliberately.

**`generate.provider` / `judge.provider`** — provider-specific objects described in the [provider guide](providers.md). When `judge.provider` is omitted, judging uses `generate.provider`. Setting it explicitly permits a different service or local model for the judge.

**`judge.enabled`** — disabling this makes the tool cheaper and materially worse. If you turn it off, expect filler docstrings and expect to review every one by hand.

**`--no-judge`** — per-run escape hatch for `fix` and `check --fix`. It cannot be used when `docs.leadingComments.onGenerate` is `replace`, because a rejected generation must never remove its source note.

**`check.reportMissing`** — off by default. Missing docs are a backlog, not a regression; failing CI on them turns adoption into the unreviewable-PR problem the tool exists to avoid. Turn it on per-path once a directory is fully documented.

## Environment

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Default Anthropic API credential for generation. |
| `OPENAI_API_KEY` | Default OpenAI API credential. |
| `GEMINI_API_KEY` | Default Google Gemini API credential. |
| `DOCGEN_CACHE_DIR` | Defaults to `.docgen/cache`. |
| `NO_COLOR` | Respected. |

## Monorepo example

```jsonc
{
  "workspace": {
    "projects": ["packages/*/tsconfig.json", "apps/*/tsconfig.json"],
    "lockfile": "perProject",
    "projectConcurrency": 1
  },
  "docs": {
    "leadingComments": {
      "includeInContext": true,
      "onGenerate": "replace"
    }
  },
  "generate": { "maxSymbolsPerRun": 250 }
}
```

This makes project boundaries the unit of indexing and lock ownership while keeping `--path` as the unit of reviewable backfill. Per-path policy overrides are still out of scope for v1; use separate invocations/config files when packages require different documentation policy.
