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

- [ ] `llm/judge.ts` — post-hoc gate: does this docstring say anything the signature does not?
- [ ] Strict mode for leaf symbols, whose summaries propagate upward
- [ ] Report rejects with reasons; `--no-judge` escape hatch
- [ ] Enable `docs.leadingComments.onGenerate: "replace"` — require the judge, reject `--no-judge`, atomically replace only eligible attached groups when accepted JSDoc backfills a missing doc, and preserve comments on `SKIP`, rejection, validation failure, concurrent change, or write failure
- [ ] Recompute post-edit hashes before lockfile writes so comment replacement cannot cause immediate false drift
- [ ] **Eval set:** 100 hand-labelled symbols from 3+ real repos, with human-written reference docstrings
- [ ] Measure: keep rate, false-keep rate (useless docs that survived), false-reject rate
- [ ] Ablation — quality with signature-only vs. full assembled context. If the difference is not visible, Phase 3 was wasted and needs rethinking, not more prompt tuning.
- [ ] Comment-promotion eval: verify that generated JSDoc retains useful intent from source notes without turning TODOs, directives, or implementation narration into public API claims

**Exit:** on the eval set, fewer than 10% of kept docstrings are judged useless by a human reviewer, and replacement tests prove no ineligible or rejected comment is removed.

---

## Phase 6 — CI, DX, release

- [ ] GitHub Action: `docgen check --since origin/main --sarif`
- [ ] Pre-commit hook recipe
- [ ] `docgen init` — interactive config bootstrap
- [ ] Config schema published as JSON Schema for editor completion
- [ ] Docs: README quickstart, config reference, CI recipes, honest limitations section
- [ ] Monorepo recipes: shared vs. per-project lockfiles, project/path-scoped backfill, memory tuning, aggregate CI reporting, and lockfile merge handling
- [ ] Cost estimation printed before any `--fix` run over N symbols
- [ ] Telemetry: none. Do not add it.
- [ ] Release v1.0.0

**Exit:** a stranger can adopt drift-checking on their repo from the README alone, without reading source.

---

## Phase 7 — Second language

Not before Phase 6. Adding a language to a mediocre TS implementation produces two mediocre implementations.

- [ ] Audit: nothing outside `adapters/typescript/` imports `ts-morph`
- [ ] Choose the second language — Python is the largest market; Go has the strongest doc culture and the simplest convention
- [ ] Adapter: symbol extraction, graph construction, doc render/parse
- [ ] Python: docstring style setting (Google / NumPy / reST); type context from annotations where present, and honest degradation where absent
- [ ] Go: identifier-prefixed comment convention, no tag vocabulary
- [ ] Cross-language fixture and eval sets
- [ ] Verify the `LanguageAdapter` interface did not need breaking changes; if it did, document why in DECISIONS

**Exit:** the second adapter is under 1,500 lines and required no changes to `core/`.

---

## Open questions

- [ ] Does `check` need a "doc is stale relative to *its own claims*" mode — e.g. `@param` names that no longer match the signature? That is checkable with zero LLM involvement and might be the cheapest real feature in the whole project. Consider promoting it into Phase 2.
- [ ] What happens when a symbol is renamed? Currently it reads as `orphaned` + `missing`. Rename detection via body hash matching is possible — is it worth it?
- [ ] Should `baseline` optionally judge the docs it is accepting, and report the ones that are already useless?
- [ ] **TypeScript 7 vs 5.** `typescript` latest is `7.0.2` (the native port); the scaffold pins `^5.9.3` because `ts-morph@28` (April 2026) vendors its own TS and the wider toolchain has not settled on 7. Revisit at Phase 6 — a native-speed compiler would materially change the Phase 1 benchmark numbers.
