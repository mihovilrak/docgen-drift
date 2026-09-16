# Build plan

Ordered so that the **first shippable thing is `docgen check`** — drift detection, no LLM, no API key, no generated docstrings. Generation is built on top of a foundation that already has to be correct for `check` to work at all. If the project stalls after Phase 2, what exists is still useful on its own.

Each phase has an exit criterion. Do not start the next phase until it is met.

---

## Phase 0 — Scaffold

- [x] `package.json` (ESM, Node >= 20), `tsconfig.json` (strict), `.gitignore`
- [x] Toolchain: `tsup` build, `vitest` test, `eslint` + `prettier`
- [x] `git init`, initial commit
- [x] CLI entry point with `cac` or `commander`; `docgen --version` runs
- [x] Fixture repos under `test/fixtures/` — a small TS project covering every symbol kind in the ARCHITECTURE table, attached/blocked/detached `//` groups, overloads, accessors, and a `Promise<void>` async function; plus a multi-project monorepo fixture with overlapping-ownership failure coverage
- [x] Decide the npm package name (`docgen-drift`; `docgen` and `docgen-cli` are taken)

**Exit:** `pnpm build && pnpm test` green on an empty test suite; `docgen --help` prints.

---

## Phase 1 — Extraction and the symbol index

No LLM. Everything here is deterministic and must be tested against fixtures.

- [x] `core/symbol.ts` — language-neutral `Symbol`, `Graph`, `Edit` types
- [x] `adapters/typescript/loadProject.ts` — resolve `tsconfig.json`, apply include/exclude
- [x] `adapters/typescript/loadWorkspace.ts` — resolve `workspace.projects`, reject duplicate source ownership, and keep project loading bounded by `projectConcurrency`
- [x] `adapters/typescript/extract.ts` — every symbol kind in the ARCHITECTURE table
  - [x] `FunctionDeclaration`
  - [x] `VariableStatement` with arrow / function-expression initializer
  - [x] `MethodDeclaration`, `MethodSignature`, get/set accessors
  - [x] `ClassDeclaration`, `InterfaceDeclaration`, `TypeAliasDeclaration`, `EnumDeclaration`
  - [x] Overloads collapsed to the implementation signature
- [x] Signature rendering built from name + type params + params + return type node — **not** from `getSignature().getDeclaration().getText()`
- [x] Correct async return handling — unwrap `Promise<T>` before deciding `@returns` applies
- [x] Per-declaration `exported` and visibility, computed not assumed
- [x] `parseExistingDoc` — read the existing JSDoc into structured tags, preserving unknown tags verbatim
- [x] Extract attached ordinary leading-comment groups as structured source notes; exclude triple-slash references, licenses, directives, trailing/detached comments, and body comments from replacement eligibility
- [x] `docgen extract --json` debug command dumping the symbol table
- [x] Benchmark: index a 100k-LOC repo and a representative multi-project monorepo sequentially; record wall time and peak RSS in `docs/benchmarks.md`

**Exit:** on the fixture repo, extraction finds 100% of expected symbols with zero false positives, and the arrow-function case is covered by a test that would fail on the naive implementation.

---

## Phase 2 — Hashing, lockfile, `baseline`, `check` — *first release*

- [x] `core/hash.ts` — signature and body normalization (strip comments, collapse whitespace, keep parameter names); include normalized attached source notes when configured as context
- [x] Symbol id scheme, stable across line moves and file reformatting
- [x] `core/lock.ts` — shared/per-project `.docgen/lock.json` read/write, workspace-safe symbol ids, schema version, forward-compatible migration
- [x] `docgen baseline` — record current state, write no docs, make no LLM calls
- [x] `docgen check` — classify `unchanged` / `drifted` / `missing` / `orphaned`
- [x] Reporters: human (default), `--json`, `--sarif` for GitHub code scanning
- [x] Exit codes per ARCHITECTURE
- [x] `--since <ref>` — restrict to symbols touched in a diff range, for fast PR-scoped CI
- [x] Opt-out pragmas: `@docgen-ignore`, `@internal`, config path excludes
- [x] Tests: reformatting does not trip drift; renaming a parameter does trip it; moving a function within a file does not; editing a body does
- [x] Tests: shared and per-project lockfiles classify the same fixture symbols identically; `check` loads projects at configured concurrency and remains read-only/LLM-free

**Exit:** run `baseline` then `check` on a real third-party TS repo, make one edit, and get exactly one drift report with no false positives. **Ship this as v0.1.0.**

---

## Phase 3 — Graph and context assembly

Still no LLM. The output of this phase is inspectable text.

- [x] Forward edges: resolve call expressions in each body to declarations, single pass
- [x] Reverse index by inverting forward edges — **not** `findReferencesAsNodes()` per symbol
- [x] Test-reference index: call sites in test files, with enclosing `it` / `test` / `describe` literals
- [x] Tarjan SCC + reverse topological ordering, cycles condensed
- [x] `core/budget.ts` — ranked knapsack over the source table in ARCHITECTURE
- [x] Attached leading comments as labelled source-note context, controlled by `docs.leadingComments.includeInContext`
- [x] Call-site extraction: line +/-2, enclosing function name, module-diversity sampling
- [x] Referenced type declarations, depth 1, fields only
- [x] `git log -L` commit subject lookup, cached, with a timeout and a clean fallback
- [x] Token counting for the target model; budget enforcement with graceful degradation
- [x] **`docgen explain <symbol>`** — print the exact assembled context for one symbol
- [x] Benchmark graph construction on the 100k-LOC repo

**Exit:** `docgen explain` on ten hand-picked symbols in a real repo produces context a human would call sufficient to write the docstring. If a human cannot write a good docstring from that bundle, the model will not either — fix the assembler before touching Phase 4.

---

## Phase 4 — Generation and insertion

- [x] `llm/client.ts` — Anthropic provider, concurrency limit, retry with backoff, cost accounting
- [x] Versioned prompt templates under `llm/prompt/`, `prompt_version` fed into the hash
- [x] Strict response schema (zod); one retry on validation failure, then drop
- [x] `SKIP` handled as a first-class outcome and reported, never coerced into a docstring
- [x] Topological-order execution: callee summaries feed callers
- [x] `renderDoc` — JSDoc rendering, no `{type}` annotations, existing unknown tags merged not clobbered
- [x] `applyEdits` — **reverse document order**, reparse on file-hash change, indentation and EOL preserved
- [x] Post-write validation: file reparses clean, or revert that edit
- [x] Prettier integration when the project has a config
- [x] `docgen check --fix` (drifted only) and `docgen fix --missing --path <p>` (backfill, path-bounded), with `--project <path-or-glob>` for monorepo scoping
- [x] Dirty-working-tree guard, `--allow-dirty` to override
- [x] `--dry-run` printing a unified diff

**Exit:** on the fixtures, generation is byte-identical across two runs given a stubbed LLM and every insertion round-trips through the parser.

---

## Phase 5 — The judge

The phase that determines whether the tool is worth running.

- [x] `llm/judge.ts` — post-hoc gate: does this docstring say anything the signature does not?
- [x] Strict mode for leaf symbols, whose summaries propagate upward
- [x] Report rejects with reasons; `--no-judge` escape hatch
- [x] Enable `docs.leadingComments.onGenerate: "replace"` — require the judge, reject `--no-judge`, atomically replace only eligible attached groups when accepted JSDoc backfills a missing doc, and preserve comments on `SKIP`, rejection, validation failure, concurrent change, or write failure
- [x] Recompute post-edit hashes before lockfile writes so comment replacement cannot cause immediate false drift
- [x] **Eval set:** 100 hand-labelled symbols from 3+ real repos, with human-written reference docstrings
- [x] Measure: keep rate, false-keep rate (useless docs that survived), false-reject rate
- [x] Ablation — quality with signature-only vs. full assembled context. If the difference is not visible, Phase 3 was wasted and needs rethinking, not more prompt tuning.
- [x] Comment-promotion eval: verify that generated JSDoc retains useful intent from source notes without turning TODOs, directives, or implementation narration into public API claims

**Exit:** on the eval set, fewer than 10% of kept docstrings are judged useless by a human reviewer, and replacement tests prove no ineligible or rejected comment is removed.

---

## Phase 6 — CI and DX

- [x] GitHub Action: `docgen check --since origin/main --sarif`
- [x] Pre-commit hook recipe
- [x] `docgen init` — interactive config bootstrap
- [x] Config schema published as JSON Schema for editor completion
- [x] Docs: README quickstart, config reference, CI recipes, honest limitations section
- [x] Monorepo recipes: shared vs. per-project lockfiles, project/path-scoped backfill, memory tuning, aggregate CI reporting, and lockfile merge handling
- [x] Cost estimation printed before any `--fix` run over N symbols
- [x] Telemetry: none. Do not add it.

**Exit:** a stranger can adopt drift-checking on their repo from the README alone, without reading source.

---

## Phase 6.5 — Pre-release portability and CLI hardening

Finish the provider and command-line seams before adding another language. The deterministic pipeline remains in control: providers return semantic JSON, while docgen owns planning, batching, judging, rendering, and edits. Direct APIs remain the reliable CI path; subscription CLIs are optional local transports, not agent-driven replacements for the pipeline.

### CLI ergonomics

- [x] Add short aliases for frequent, unambiguous options: `-p` / `--path`, `-P` / `--project`, `-c` / `--config`, `-j` / `--json`, `-s` / `--since`, `-f` / `--fix`, `-m` / `--missing`, `-n` / `--dry-run`, and `-a` / `--allow-dirty`
- [x] Keep safety-sensitive or uncommon flags long-only where an abbreviation would be unclear, including `--no-judge`, `--sarif`, and `--include-variables`
- [x] Test that every short form is identical to its long form, that collisions are rejected, and that command help shows both forms
- [x] Add provider/model inspection and authentication preflight commands without making `check` load a provider or require credentials
- [x] Keep configuration authoritative, with explicit per-run provider/model overrides only for generation commands
- [x] Add live generation progress and structured operational logging; provide `--verbose` for per-symbol/provider detail and `--quiet` for errors and final machine-relevant output only

### Provider abstraction

- [x] Make `LlmProvider` a supported runtime seam rather than a test-only injection point; keep provider code under `src/llm/providers/`
- [x] Replace the Anthropic-only config literal and factory with a discriminated provider configuration that validates provider-specific fields
- [x] Allow generation and judging to use different providers and models
- [x] Retain the direct Anthropic API provider and add direct OpenAI and Google Gemini API support
- [x] Add an OpenAI-compatible HTTP provider with configurable base URL and credential environment variable
- [x] Move retry classification, token usage, model capabilities, and price lookup behind the provider boundary
- [x] Report subscription allowance or unknown/local cost honestly; never render unavailable cost as `$0.00`
- [x] Use provider tokenizers where practical and a documented conservative fallback elsewhere
- [x] Add a provider conformance suite covering generation, `SKIP`, judging, schema failures, retries, timeouts, cancellation, and usage accounting; all normal tests remain stubbed and require no credentials

### Local models

- [x] Support Ollama, LM Studio, llama.cpp, vLLM, and similar servers through the OpenAI-compatible provider
- [x] Require or probe JSON Schema constrained output and fail clearly when the selected server/model cannot satisfy the response contract
- [x] Validate context-window limits before a run and degrade the context budget explicitly rather than relying on server-side truncation
- [ ] Run the Phase 5 generation and judge evals on at least one representative local model; document quality and hardware as measured, not equivalent by assumption
- [x] Permit separate local generation and judge models so a weak judge does not silently approve a weak generator

### Subscription and agent CLI transports

- [x] Add opt-in transports for the official `claude -p`, `codex exec`, and Gemini CLI non-interactive interfaces, using their structured-output modes
- [x] Add optional OpenCode and Pi transports through their documented non-interactive, SDK, or RPC interfaces
- [x] Invoke only a user-installed executable and inherit its existing authentication; never read, copy, refresh, or expose CLI credential files
- [x] Run transports without source-write tools, with read-only/restricted permissions, no session persistence, bounded timeouts, cancellation, and captured stderr
- [x] Detect missing executables, interactive-login requirements, exhausted subscription limits, unsupported models, and malformed output with actionable errors
- [x] Document that upstream provider terms still govern subscription use, that accounts and allowances must not be shared or resold, and that direct API credentials are recommended for shared or unattended CI
- [x] Clarify ADR-011: CLI/SDK integrations are completion transports only; docgen still owns batching and no external agent chooses source spans or applies edits

### Dogfooding and release gate

- [x] Update the README quickstart with the shortest API-backed setup, short-flag examples, a bounded dry run, and the first `baseline` / `check` workflow
- [x] Write a provider guide covering direct APIs, official subscription CLIs, OpenCode, Pi, local OpenAI-compatible servers, authentication and credential safety, provider/model selection, generation-versus-judge configuration, cost reporting, CI recommendations, troubleshooting, and terms caveats
- [x] Write a concise Markdown quick guide for later web publication, covering installation, first configuration, subscription and API authentication, dry runs, applying changes, baselining, and CI checks
- [x] Write a complete Markdown tutorial for later web publication, organized into reusable pages with examples, expected output, safety notes, provider choices, troubleshooting, and an end-to-end adoption workflow
- [x] Add entry-point-aware public-surface filtering so `exportedOnly` can distinguish package API from implementation exports; retain syntactic-export mode as an explicit policy
- [ ] Dogfood `fix --missing` on this repository in reviewable path-bounded batches, starting with the public modules; commit and validate the resulting lockfile
- [ ] Run `baseline` then `check` on the dogfooded repository and verify that one symbol edit produces exactly one drift finding
- [x] Remove intermittent test timeouts and run build, test, lint, and typecheck successfully in the release environment
- [ ] Reconcile the package version with release state, publish v1.0.0, and mark the release in the changelog

**Exit:** the same fixture generation contract passes through Anthropic, OpenAI, OpenAI-compatible local, and stubbed CLI transports; `check` remains offline, LLM-free, and unchanged in performance; this repository has been dogfooded; and v1.0.0 is published.

---

## Phase 7 — PHP adapter

Not before Phase 6.5. PHP is the second language because there is a concrete adopter and evaluation project. Add one complete adapter before broadening the language list.

- [ ] Audit: nothing outside `adapters/typescript/` imports `ts-morph`
- [ ] Turn the documented `LanguageAdapter` sketch into the runtime boundary used by discovery, indexing, explaining, generation, and edits; remove direct TypeScript adapter selection from shared CLI orchestration
- [ ] Generalize language-neutral types only where PHP proves a concrete need, such as traits or properties; document every breaking interface or core change in DECISIONS
- [ ] Define Composer-root discovery, autoload-aware project boundaries, include/exclude defaults, test discovery, project concurrency, and duplicate source ownership
- [ ] Choose the PHP parsing foundation in an ADR after a focused spike: compare `nikic/php-parser` and Tree-sitter on exact offsets, namespace/name resolution, PHP version coverage, formatting preservation, performance, distribution, and runtime dependencies
- [ ] Extract namespace functions, classes, interfaces, traits, enums, methods, constructors, properties, and closures assigned to stable names; define overload-like and magic-member behavior explicitly
- [ ] Render and parse PHPDoc while preserving unknown tags, annotations, `@template`, `@phpstan-*`, and `@psalm-*`; the model still returns plain semantic strings and never emits PHPDoc markup or types
- [ ] Build forward and reverse graph edges for statically resolvable function, method, constructor, and static calls in one forward pass
- [ ] Degrade honestly for dynamic callables, variable method names, magic methods/properties, framework containers, facades, and runtime-generated APIs; unresolved edges must not become guessed edges
- [ ] Apply PHP edits in reverse document order, preserve indentation and EOLs, reparse after edits, and use project formatting only when deterministically configured
- [ ] Add PHP opt-out handling, visibility/export policy, stable ids, symbol hashes, comment eligibility, and project-bounded lockfile behavior
- [ ] Add PHP fixtures covering modern syntax, namespaces/import aliases, traits, attributes, anonymous classes, promoted properties, enums, ordinary comments, PHPDoc annotations, dynamic calls, and malformed files
- [ ] Build a hand-labelled PHP eval set from the adopter project and at least one independent repository; run the same generation, judge, comment-promotion, and drift checks used for TypeScript
- [ ] Benchmark extraction, graph construction, and `check` on a representative Composer project

**Exit:** PHP `baseline`, `check`, `explain`, `check --fix`, and bounded missing-doc backfill satisfy the same safety and drift invariants as TypeScript; adapter-specific behavior stays outside `core/`, and any necessary shared-type changes have an ADR.

---

## Phase 8 — Additional language adapters

Add languages one at a time. Each adapter must independently meet the Phase 7 quality, safety, performance, fixture, and eval bar before work starts on the next.

### Phase 8A — Python

- [ ] Python project/environment discovery without importing user code
- [ ] Functions, async functions, classes, methods, properties, protocols, dataclasses, and typed assignments where policy includes them
- [ ] Docstring style setting: Google, NumPy, and reStructuredText
- [ ] Type context from annotations where present, with honest degradation where absent
- [ ] Static import/call resolution where reliable; no guessed edges for dynamic dispatch

### Phase 8B — Go

- [ ] Module/package discovery through `go.mod` and project-bounded package loading
- [ ] Functions, methods, types, interfaces, structs, fields, constants, and variables under Go export rules
- [ ] Identifier-prefixed documentation convention with no invented tag vocabulary
- [ ] Type-aware call graph and test-example context using the Go toolchain

### Phase 8C — Rust

- [ ] Cargo workspace and crate-bounded discovery honoring configured concurrency
- [ ] Functions, structs, enums, traits, impl methods, modules, constants, and public re-exports
- [ ] Rustdoc `///` / `//!` rendering and parsing while preserving attributes, intra-doc links, examples, and unknown sections
- [ ] Resolve calls and referenced types where the Rust toolchain provides reliable semantics; document macro and generated-code limits

### Shared requirements

- [ ] Maintain shared cross-language adapter conformance fixtures without forcing language-specific concepts into `core/`
- [ ] Publish a capability matrix covering symbol kinds, graph precision, documentation syntax, formatter integration, and known dynamic-language limitations

**Exit:** Python, Go, and Rust adapters each ship only after their own fixture, real-repository drift validation, eval threshold, and performance benchmark pass.

---

## Open questions

- [ ] Does `check` need a "doc is stale relative to *its own claims*" mode — e.g. `@param` names that no longer match the signature? That is checkable with zero LLM involvement and might be the cheapest real feature in the whole project. Consider promoting it into Phase 2.
- [ ] What happens when a symbol is renamed? Currently it reads as `orphaned` + `missing`. Rename detection via body hash matching is possible — is it worth it?
- [ ] Should `baseline` optionally judge the docs it is accepting, and report the ones that are already useless?
- [x] **TypeScript 7 vs 5.** Reviewed in Phase 6: remain on `^5.9.3` because `ts-morph@28` and the surrounding toolchain have not settled on the TypeScript 7 native port. Revisit when the adapter can upgrade without changing extraction semantics.
