# 1. Install, scope, and inspect

This tutorial follows one function through selection, optional generation, and
a deliberate documentation drift. Commands use pnpm and require Node.js 20 or
newer. Start in a Git repository containing a TypeScript project, or create a
small scratch repository for the example.

## Install and create the example

```bash
pnpm add -D docgen-drift
pnpm exec docgen init
```

For a single project, accept `tsconfig.json`, shared lockfiles, and project
concurrency `1`. Your TypeScript configuration must include `src/**/*.ts`.

Create `src/public-api.ts`:

```ts
// Empty input has no maximum; keep zero as the display fallback.
export const highestScore = (scores: readonly number[]): number => {
  if (scores.length === 0) return 0;
  return Math.max(...scores);
};
```

Use this `.docgenrc.json` to keep the tutorial limited to that file:

```json
{
  "$schema": "https://unpkg.com/docgen-drift@1/schema/docgen.schema.json",
  "include": ["src/public-api.ts"],
  "symbols": {
    "exportedOnly": true,
    "publicSurface": "syntacticExports",
    "minBodyLines": 0
  }
}
```

Commit the dependency files, config, and example before applying generated
changes. Dry runs can inspect an uncommitted tree.

For a library, `symbols.publicSurface: "entryPoints"` with
`symbols.entryPoints: ["src/index.ts"]` restricts eligibility to exports reachable
from those entry points. For multiple projects, see the
[monorepo guide](../monorepos.md).

## Inspect the effective policy

```bash
pnpm exec docgen check --json
```

In this isolated example, the summary contains one missing symbol and no drift.
Missing documentation does not fail the check by default. Inspect `results` for
the ID `src/public-api.ts#highestScore`.

`docgen extract --json` is a lower-level diagnostic: it shows raw declarations,
including test symbols and symbols excluded by visibility, public-surface, or
minimum-body policy. Use `check --json` to evaluate those policy settings.

## Inspect available context

```bash
pnpm exec docgen explain 'src/public-api.ts#highestScore'
```

The output includes the source note and implementation. It is offline context
inspection, not an exact generation prompt: generation can add a shared module
outline and newly generated callee summaries, and adjust the budget for the
provider. No credential is needed for this command.

## JavaScript projects

Use a `tsconfig.json` with `allowJs: true` and your JavaScript paths in
`include`. For example:

```json
{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": false,
    "noEmit": true
  },
  "include": ["src/**/*.js"]
}
```

Set docgen's `include` and `tests` globs too; its defaults select TypeScript.
For example, `include: ["src/**/*.{js,jsx}"]` and
`tests: ["**/*.{test,spec}.{js,jsx}"]`. Keep `docs.emitTypes: false` to omit
JSDoc type annotations. Enable it deliberately when you want annotations in
JavaScript; `checkJs` controls TypeScript's checking and does not automatically
change docgen's output policy.

Continue to [generate a batch](02-generate-a-batch.md), or write the JSDoc
yourself and proceed to [baseline and CI](03-baseline-and-ci.md).
