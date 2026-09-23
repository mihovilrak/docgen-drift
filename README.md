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

For a shorter annotated walkthrough, see the [quick guide](docs/quick-guide.md).
The [full tutorial](docs/tutorial/index.md) covers scoping, provider choices,
reviewable generation, baselining, CI, and troubleshooting.

After the baseline is committed, run `check` in CI:

```bash
pnpm exec docgen check -s origin/main
```

Exit code `0` is clean, `1` means documentation drift was found, `2` is a
configuration or usage error, and `3` is an internal failure. See
[CI recipes](docs/ci.md) for SARIF upload and [the pre-commit recipe](docs/pre-commit.md)
for a local check.

## Fixing drift

The shortest API-backed setup uses Anthropic. Set `ANTHROPIC_API_KEY`; the
default config already selects the Anthropic provider. Inspect the effective
generation and judge models without making a model call:

```bash
pnpm exec docgen providers
pnpm exec docgen auth
```

Preview a bounded missing-doc run before writing anything:

```bash
pnpm exec docgen fix -m -p src/api -n
pnpm exec docgen fix -m -p src/api
```

Fixing existing drift is separate:

```bash
pnpm exec docgen check -f -n
pnpm exec docgen check -f
```

Every fix run reports its selected symbol count and estimated cost
before the first model call. Source writes require a clean working tree unless
`--allow-dirty` is passed. Generated output is schema-validated and judged for
information beyond the signature; `SKIP` and judge rejection leave source
unchanged.

Generation progress is written to stderr, leaving diffs and `--json` output on
stdout. Use `--verbose` for per-symbol provider/model results or `--quiet` to
suppress the estimate and live progress while retaining final output.
Machine-readable results include generation and judge request, attempt, outcome,
and timing totals. Add `--evaluation <path>` to write a separate JSON artifact
containing source identifiers, semantic model output, judge decisions, rendered
comments, and edit status:

```bash
pnpm exec docgen fix -m -p src/api -n --evaluation .docgen/evaluation.json
```

Raw provider diagnostics are omitted from normal progress output. Use
`--verbose` while troubleshooting; evaluation artifacts also retain diagnostics
for failed records.

Direct OpenAI and Google APIs, OpenAI-compatible local servers, and opt-in
Claude, Codex, Gemini, OpenCode, and Pi CLI transports are also supported. See
the [provider guide](docs/providers.md) for configuration, credential safety,
CI guidance, and local-server requirements.

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

## Token cost and caching

Every `fix` and `check --fix` run prints an upper-bound estimate before the
first model call. With the defaults — a 2,000-token context budget,
`claude-sonnet-5` for generation, `claude-haiku-4-5` for judging — that bound is
per symbol:

| Stage | Input | Output | List cost |
| --- | --- | --- | --- |
| generation | 2,300 | 300 | $0.0114 |
| judge | 2,800 | 80 | $0.0032 |
| total | 5,100 | 380 | ~$0.015 |

So roughly **$15 per 1,000 symbols**, or about $1.50 with judging disabled and a
Haiku-class generation model. Real runs land under the bound, because the
context knapsack usually does not fill the budget: a symbol with no tests, no
call sites, and a short body sends far less than 2,000 tokens. Subscription CLI
transports report no token counts at all, so their cost basis is `unknown` and
no monetary total is printed.

Caching is layered on top:

- The system prompt is a cache breakpoint on Anthropic, so it is written once
  per run and read thereafter.
- When a file contributes at least `context.shared.minSymbols` documented
  symbols, docgen builds one **module outline** — the file path plus its sibling
  declarations — and sends it as a shared prefix marked as an Anthropic cache
  breakpoint. The judge receives the same prefix, so a claim grounded in a
  sibling declaration is not rejected as unsupported.
- Requests are ordered so the first request carrying a given prefix is issued
  and awaited before the requests that read it, instead of racing under
  `generate.concurrency` and each paying a cache write.
- The outline is charged **against** `context.budgetTokens`, never added to it.
  Per-symbol context shrinks by the outline's size, and same-file referenced
  type blocks that the outline already renders are dropped, so a request does
  not grow just because its file has an outline.

Honest accounting: a cached prefix costs 1.25 copies to write and 0.1 copies per
read, so substituting shared content for per-symbol content breaks even at about
four documented symbols in a file and runs roughly 10-15% below the uncached
input cost at eight. Files with one or two documented symbols gain nothing
monetarily — and a prefix below Anthropic's minimum cacheable length is silently
not cached — so the main return is quality: the model sees what a symbol sits
next to, which matters most for types and interfaces whose own signature says
nothing about their purpose. Providers without cache controls, including the CLI
transports, inline the same prefix so generated content stays provider
independent.

## Configuration and monorepos

Configuration lives in `.docgenrc.json`. See the [config reference](docs/config.md)
for every field and default. Large workspaces should also read the
[monorepo recipes](docs/monorepos.md) before baselining.

With `symbols.exportedOnly: true`, `symbols.publicSurface` defaults to
`"syntacticExports"`. Published libraries can set it to `"entryPoints"` and
list their package entry modules so exported implementation helpers are not
treated as public API.

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
