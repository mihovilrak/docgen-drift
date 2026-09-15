# CI recipes

Commit `.docgen/lock.json` or the configured per-project lockfiles before adding
CI. `check` is read-only, requires no API key, and should run on pull requests.

## GitHub Actions with SARIF

This workflow limits checks to files changed from the target branch and uploads
findings to GitHub code scanning. Full history is required so `origin/main` can
be resolved.

```yaml
name: Documentation drift

on:
  pull_request:

permissions:
  contents: read
  security-events: write

jobs:
  docgen:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: pnpm/setup@v2
        with:
          version: 12.4.1
          runtime: node@22
          cache: true
      - run: pnpm install --frozen-lockfile
      - id: docgen
        continue-on-error: true
        run: pnpm exec docgen check --since origin/main --sarif > docgen.sarif
      - if: always() && hashFiles('docgen.sarif') != ''
        uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: docgen.sarif
      - if: steps.docgen.outcome == 'failure'
        run: exit 1
```

The check step is allowed to finish so its SARIF file can be uploaded, then the
last step restores docgen's failing status.

## Plain CI output

For CI systems without SARIF support:

```bash
git fetch origin main --depth=1
pnpm install --frozen-lockfile
pnpm exec docgen check --since origin/main
```

Omit `--since` for a full-repository check. Use `--json` when another tool will
consume the report. `--json` and `--sarif` are mutually exclusive.

Do not put provider credentials in the drift-check job. They are not needed,
and their absence protects the LLM-free CI path from accidental generation.
For unattended generation jobs, use a direct API credential scoped to that CI
environment. Subscription CLI transports depend on an interactive user's login
and allowance and are intended for local runs.
