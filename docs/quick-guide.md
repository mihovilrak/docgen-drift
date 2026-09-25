# Quick guide

Use docgen to detect JSDoc that stopped changing when its implementation did.
The normal `check` workflow is read-only, offline, and does not need an LLM.
Generation is an explicit, path-bounded fix operation.

## Install and configure

Requirements: Node.js 20 or newer and a TypeScript project with a
`tsconfig.json`.

```bash
pnpm add -D docgen-drift
pnpm exec docgen init
```

For a single project, accept the three defaults from `init`. Review the created
`.docgenrc.json`; in particular, confirm the TypeScript project paths and which
exported symbols are in scope. See the [configuration reference](config.md) for
all fields.

## Choose generation authentication

You do not need a provider for `baseline`, `check`, `extract`, or `explain`.
Configure one only if you will generate documentation.

For a direct Anthropic API connection:

```json
{
  "generate": {
    "provider": { "kind": "anthropic" },
    "model": "claude-sonnet-5"
  }
}
```

Set the credential in the shell that will run docgen:

```bash
export ANTHROPIC_API_KEY="..."
pnpm exec docgen auth
```

For an existing Claude subscription login:

```json
{
  "generate": {
    "provider": { "kind": "cli", "tool": "claude" },
    "model": "sonnet",
    "concurrency": 1
  },
  "judge": { "enabled": true, "model": "sonnet" }
}
```

Run `claude` interactively once to sign in, then run:

```bash
pnpm exec docgen providers
pnpm exec docgen auth
```

`auth` checks the executable or environment-variable presence only. It does not
make a model request and cannot prove that a configured model is available to
the account. Use the bounded dry run below as the final provider test. Codex,
Gemini, OpenCode, Pi, OpenAI, Google, and local OpenAI-compatible configurations
are covered in the [provider guide](providers.md).

## Preview a small generation

For the Bash examples, create an artifact directory outside the repository:

```bash
preview_dir=$(mktemp -d)
```

Pick one public file or narrow directory. Missing-doc generation requires
`--path` and prints an estimate before the first model request.

```bash
pnpm exec docgen fix --missing --path src/public-api.ts --dry-run \
  > "$preview_dir/docgen-preview.txt"
```

Progress and the estimate go to stderr; the proposed unified diff goes to the
file. Review both. Use `--verbose` when diagnosing a provider or judge result:

```bash
pnpm exec docgen fix -m -p src/public-api.ts -n --verbose \
  > "$preview_dir/docgen-preview.txt"
```

A successful final line resembles:

```text
1 generated, 0 skipped, 0 rejected, 0 failed in 1 file; ...
```

`SKIP` and judge rejection are normal outcomes and do not modify source. A dry
run never writes source files.

## Apply and review

Commit dependency and configuration changes first. Running without `--dry-run`
generates again; it does not apply the saved preview. Expect another set of
model calls and potentially different output:

```bash
pnpm exec docgen fix -m -p src/public-api.ts
```

docgen refuses to write when the working tree is dirty. Commit or stash other
work first. Use `--allow-dirty` only when you have deliberately reviewed that
risk. Inspect the source diff and run the project test suite before accepting
generated documentation.

## Create the baseline

After the existing and generated JSDoc is in the state you want to accept:

```bash
pnpm exec docgen baseline
pnpm exec docgen check
```

Expected output is similar to:

```text
Baselined 140 symbols in 1 lockfile.
0 drifted, 87 missing, 0 orphaned, 53 unchanged.
```

Missing documentation is reported in the count but does not fail by default.
Commit `.docgenrc.json` and the generated `.docgen/lock.json` together with the
reviewed source changes.

## Add the CI check

```bash
pnpm exec docgen check --since origin/main
```

Exit code `0` is clean, `1` means reportable drift, `2` is a configuration or
usage error, and `3` is an internal failure. The check is read-only and requires
no provider credentials. See [CI recipes](ci.md) for SARIF upload and
[pre-commit](pre-commit.md) for the optional local hook.

## Fix later drift

Preview and then apply only the symbols whose implementation changed without a
matching JSDoc change:

```bash
pnpm exec docgen check --fix --dry-run > "$preview_dir/docgen-drift-preview.txt"
pnpm exec docgen check --fix
```

Before generating, inspect a symbol's available context without an LLM call.
This offline view omits shared outlines and summaries produced during generation:

```bash
pnpm exec docgen explain 'src/public-api.ts#lookupAccount'
```

For a guided adoption with safety notes and troubleshooting, continue with the
[full tutorial](tutorial/index.md).
