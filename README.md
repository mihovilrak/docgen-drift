# docgen

Symbol-level documentation drift detection for TypeScript and JavaScript.
`docgen check` catches documented symbols whose implementation changed while
their JSDoc did not. It is read-only, runs offline, and never calls an LLM.
Generation is an explicit fix path.

## Quickstart

Requirements: Node.js 20 or newer and a TypeScript project with a
`tsconfig.json`.

```bash
pnpm add -D docgen-drift
pnpm exec docgen init
pnpm exec docgen baseline
git add .docgenrc.json .docgen/lock.json
git commit -m "adopt docgen drift checks"
pnpm exec docgen check
```

`init` asks for TypeScript project paths, lockfile placement, and project
concurrency. The generated `.docgenrc.json` links to the published JSON Schema
for editor completion. `baseline` records the documentation state without
writing source files or calling an LLM.

After the baseline is committed, run `check` in CI:

```bash
pnpm exec docgen check --since origin/main
```

Exit code `0` is clean, `1` means documentation drift was found, `2` is a
configuration or usage error, and `3` is an internal failure. See
[CI recipes](docs/ci.md) for SARIF upload and [the pre-commit recipe](docs/pre-commit.md)
for a local check.

## Fixing drift

Generation uses Anthropic and requires `ANTHROPIC_API_KEY`. Preview changes
before writing them:

```bash
pnpm exec docgen check --fix --dry-run
pnpm exec docgen check --fix
```

Backfilling undocumented symbols is separate, path-bounded, and deliberately
opt-in:

```bash
pnpm exec docgen fix --missing --path src/api --dry-run
pnpm exec docgen fix --missing --path src/api
```

Every fix run reports its selected symbol count and estimated cost
before the first model call. Source writes require a clean working tree unless
`--allow-dirty` is passed. Generated output is schema-validated and judged for
information beyond the signature; `SKIP` and judge rejection leave source
unchanged.

## How drift detection works

The lockfile stores a normalized implementation hash and documentation hash per
stable symbol id. A symbol is drifted when its implementation hash changes but
its documentation hash does not. Reformatting and line moves are normalized
away; parameter renames and body changes are not.

```text
stored symbol hash != current symbol hash
and
stored doc hash == current doc hash
```

The unit is a symbol, not a file, so one implementation change produces one
finding. `check` does not load an LLM provider and never writes source files.

## Generation context

For each selected symbol, docgen assembles attached source notes, referencing
test names, the symbol body, diverse call sites, already-generated callee
summaries, referenced type fields, and an optional `git log -L` subject. The
model returns semantic JSON only; the TypeScript adapter owns JSDoc structure,
tag names, placement, and validated source edits.

Ordinary attached `//` groups are context by default and are preserved. Setting
`docs.leadingComments.onGenerate` to `"replace"` allows only structurally
eligible groups to be atomically replaced after generation and judging succeed.
Directives, licenses, detached comments, and body comments are never candidates.

Use `docgen explain <symbol-id>` to inspect the exact context without making a
model call:

```bash
pnpm exec docgen explain 'src/billing/settle.ts#settleInvoice'
```

## Configuration and monorepos

Configuration lives in `.docgenrc.json`. See the [config reference](docs/config.md)
for every field and default. Large workspaces should also read the
[monorepo recipes](docs/monorepos.md) before baselining.

## Limitations

- TypeScript and JavaScript are the only supported languages.
- Drift means code changed while its doc text did not. docgen does not prove
  that a changed doc is correct, nor detect a stale claim when code is unchanged.
- A renamed symbol is currently reported as one orphaned id plus one missing id;
  rename matching is not implemented.
- Cross-project call-graph edges are not built. Each configured TypeScript
  project is useful in isolation, but generation context can miss callers or
  callees across project boundaries.
- Generation quality depends on available source context and the configured
  model. The judge reduces filler; it does not prove semantic correctness.
- Prettier is applied only when a project configuration resolves. Otherwise
  docgen preserves indentation and line endings but does not reformat a file.
- TypeScript 5.9 remains pinned through ts-morph 28. The TypeScript 7 native
  compiler is not adopted until ts-morph and the surrounding toolchain support
  it without compromising extraction correctness.

## Design

Drift detection is the product; bulk generation is the `--fix` flag. The core
invariant is that the AST owns structure and the LLM owns semantics. See
[ARCHITECTURE.md](ARCHITECTURE.md), [DECISIONS.md](DECISIONS.md), and
[PLAN.md](PLAN.md).
