# Monorepo recipes

docgen treats every configured `tsconfig.json` as an isolation boundary. It
does not create one implicit workspace-wide compiler program. Reports, cost
estimates, failures, and generation limits are aggregated by the CLI after the
selected projects finish.

## Configure project boundaries

```json
{
  "$schema": "https://unpkg.com/docgen-drift@1/schema/docgen.schema.json",
  "workspace": {
    "projects": [
      "packages/*/tsconfig.json",
      "apps/*/tsconfig.json"
    ],
    "lockfile": "perProject",
    "projectConcurrency": 1
  },
  "generate": {
    "maxSymbolsPerRun": 250
  }
}
```

Project globs are relative to the workspace root. A source file claimed by two
projects is a configuration error; fix the `tsconfig.json` boundaries instead
of allowing the symbol to be indexed twice.

## Shared or per-project lockfiles

| Mode | Location | Use when | Tradeoff |
| --- | --- | --- | --- |
| `shared` | `<workspace>/.docgen/lock.json` | CI and ownership are centralized | One artifact, with more merge contention |
| `perProject` | `<project>/.docgen/lock.json` | Packages have independent owners or release cycles | Fewer conflicts, with lockfiles spread across the workspace |

Both modes classify symbols identically. Choose the ownership model before the
initial `baseline`; changing it later requires creating and reviewing a new
baseline.

## Bound checks and backfills

Run all configured projects and aggregate one report:

```bash
pnpm exec docgen check --since origin/main --sarif > docgen.sarif
```

Limit a check or drift fix to one project path or project glob:

```bash
pnpm exec docgen check --project packages/billing
pnpm exec docgen check --project 'packages/billing/tsconfig*.json' --fix --dry-run
```

Missing-doc backfill must also be path-bounded. Paths are workspace-relative,
including when lockfiles are per-project:

```bash
pnpm exec docgen fix --missing \
  --project packages/billing \
  --path packages/billing/src/public \
  --dry-run
```

`generate.maxSymbolsPerRun` is a workspace-wide cap across every selected
project, not a per-project allowance. Raise it only after reviewing the selected
count and cost estimate.

## Tune memory explicitly

`workspace.projectConcurrency` controls how many TypeScript compiler programs
may be resident at once. Start at `1`, record wall time and peak RSS in CI, then
increase one step at a time. More concurrency improves throughput only while
the runner has enough memory for every resident ts-morph program. It does not
change results.

If memory remains high, narrow a job with `--project` and create a CI matrix over
non-overlapping project groups. Each invocation still emits a complete human,
JSON, or SARIF report for its selected projects. Concatenate human logs at the
CI layer; keep JSON and SARIF files separate unless the CI system has a schema-
aware merge step.

Cross-project call-graph edges are not built in v1. This does not affect drift
classification, but generated context may omit relationships across project
references.

## Resolve lockfile merges

Per-project lockfiles are the simplest way to avoid unrelated teams editing the
same artifact. For a shared lockfile conflict:

1. Resolve source and JSDoc conflicts first.
2. Merge non-conflicting entries by their symbol id; line numbers are metadata,
   not identity.
3. For an entry changed on both branches, inspect the final symbol and JSDoc,
   then run `docgen baseline` only if intentionally accepting that final state.
4. Run a full `docgen check` without `--since` before committing the resolution.

`baseline` is an acceptance operation: it records the current state as clean.
Do not use it blindly to erase a conflict, because that can accept documentation
drift that should have been fixed.
