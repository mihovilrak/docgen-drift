# 3. Baseline and enforce drift checks

The baseline accepts the repository's current documentation state. It does not
generate documentation or modify source files.

## Create and review the baseline

```bash
pnpm exec docgen baseline
```

Expected output:

```text
Baselined 140 symbols in 1 lockfile.
```

With a shared lockfile, review `.docgen/lock.json`. With
`workspace.lockfile: "perProject"`, review the lockfile beside every selected
project. Entries are keyed by stable symbol id, not line number.

Immediately verify the state:

```bash
pnpm exec docgen check
```

```text
0 drifted, 87 missing, 0 orphaned, 53 unchanged.
```

Missing docs are counted but do not fail by default. This allows incremental
adoption without requiring a repository-wide backfill. Enable
`check.reportMissing` only after the selected scope is intentionally complete.

Commit the reviewed config, lockfile, and any accepted documentation together.

## See one drift finding

Change the body or a parameter name of a documented symbol without changing its
JSDoc, then run:

```bash
pnpm exec docgen check
```

Example:

```text
src/billing/settle.ts:18 drifted src/billing/settle.ts#settleInvoice
1 drifted, 87 missing, 0 orphaned, 52 unchanged.
```

The process exits with code `1`. Reformatting and moving a symbol within a file
are normalized away; semantic body changes and parameter renames are not.

To fix the finding manually, update its JSDoc and rerun `baseline` only when you
intend to accept the complete current state. For a generated proposal:

```bash
pnpm exec docgen check --fix --dry-run > docgen-drift-preview.diff
pnpm exec docgen check --fix
```

`check --fix` targets drifted symbols only. Missing-doc backfill remains the
separate `fix --missing --path ...` workflow.

## Add a pull-request check

The normal CI command is:

```bash
pnpm exec docgen check --since origin/main
```

`--since` filters the report to symbols touched in the Git diff. Fetch enough
history for the reference to resolve. Omit it for a full-repository check.

Exit codes are stable:

| Code | Meaning |
| ---: | --- |
| 0 | clean |
| 1 | documentation drift or another configured reportable issue |
| 2 | invalid configuration or command usage |
| 3 | internal failure |

Do not provide LLM credentials to this job. `check` never constructs a provider
and never writes source files.

For GitHub code scanning, use SARIF:

```bash
pnpm exec docgen check --since origin/main --sarif > docgen.sarif
```

The complete workflow, including preserving the failing exit status after
upload, is in [CI recipes](../ci.md).

## Handle lockfile changes

When source and JSDoc intentionally change together, docgen still needs the new
accepted hashes. Run `baseline` after reviewing those changes and include the
lockfile update in the same pull request.

For a shared-lockfile merge conflict:

1. Resolve source and JSDoc conflicts first.
2. Merge entries by symbol id; line numbers are metadata.
3. Inspect any entry changed on both branches.
4. Baseline only the final state you intend to accept.
5. Run a full `docgen check` before committing the resolution.

Next: [provider operation and troubleshooting](04-providers-and-troubleshooting.md).
