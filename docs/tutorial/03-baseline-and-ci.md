# 3. Baseline and enforce drift checks

Continue after reviewing the JSDoc on `highestScore`. If you skipped generation,
add the sample JSDoc from page 2 manually.

## Accept the reviewed state

```bash
pnpm exec docgen baseline
pnpm exec docgen check
```

With only the tutorial file selected and documented:

```text
Baselined 1 symbols in 1 lockfile.
0 drifted, 0 missing, 0 orphaned, 1 unchanged.
```

Baseline records the state of existing documentation; it does not evaluate its
accuracy. Review and commit the config, source, and `.docgen/lock.json` together.
See [upgrading lockfiles](../upgrading.md) if an earlier release created yours.

## Produce one drift finding

Change only the empty-input branch:

```ts
if (scores.length === 0) return -1;
```

Leave the comment saying “zero,” then run:

```bash
pnpm exec docgen check
```

The report identifies `src/public-api.ts#highestScore` as drifted, summarizes
`1 drifted, 0 missing, 0 orphaned, 0 unchanged.`, and exits with code `1`.
The reported line depends on the comment generated or written on page 2.

Update the comment to say “minus one.” Run `check` again; it no longer reports
unchanged documentation against changed code. Review both changes, then run
`baseline` to record the new accepted state. Do not baseline merely to silence
a finding.

For an optional model-assisted fix, use `check --fix --dry-run` and then
`check --fix`. As on page 2, applying makes another generation run.

## Add CI

A full check is the simplest CI command:

```bash
pnpm exec docgen check
```

To limit findings to a pull request's changes, use `--since` with its fetched
base reference. For a PR targeting main, that might be:

```bash
pnpm exec docgen check --since origin/main
```

Substitute the actual target branch. `--since` filters the report; it does not
promise that only changed files will be loaded. No model credentials belong in
this job.

| Exit code | Meaning |
| ---: | --- |
| 0 | clean |
| 1 | drift or another configured reportable issue |
| 2 | configuration or usage error |
| 3 | internal failure |

See [CI recipes](../ci.md) for a complete workflow with SARIF upload.

## Maintain the baseline

When code and documentation change together, review them before updating the
baseline. For a shared-lockfile conflict, resolve source and documentation first,
then review and baseline the final state. Per-project lockfiles use the same
acceptance rule; see [monorepos](../monorepos.md).

Next: [provider operation and troubleshooting](04-providers-and-troubleshooting.md).
