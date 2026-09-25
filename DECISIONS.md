# Decisions

Architecture decision records. Each entry states what was decided, what evidence drove it, and what it costs. Several of these reject ideas that look obviously right, so read the reasoning before overturning one.

---

## ADR-001 — Drift detection is the product; bulk backfill is the fix path

**Status:** accepted

**Context.** The obvious product is "document my repo with AI." That product has been built repeatedly by well-resourced teams and it is a graveyard. Verified via the npm registry API, GitHub, and the VS Code marketplace (August 2026):

| Tool | Reach | State |
| --- | --- | --- |
| Mintlify Writer | 1,388,638 installs, 3.1k stars, 4.5 stars / 90 reviews | **Archived 2026-06-12**, hosted version disabled |
| doc-comments-ai | 260 stars, 40 forks | **Archived 2026-02-16** |
| Crystal-Spider JSDoc Generator | 73,596 installs, 8 ratings | Last updated 2025-08-13 |
| jsdoc-scribe | 6,796 weekly downloads, spiky | Active, solo author, explicitly *"100% local, no AI"* |
| Lehre | 144 weekly downloads | — |
| ts-to-jsdoc | 445 weekly downloads | — |

1.4M installs proves demand for the *outcome*. Archived-at-peak proves the product does not retain. The pattern — huge install count, tiny rating count, eventual archive — is a tool people run once and never open again.

The failure mode is not cost and not quality. It is that **a 2,500-docstring pull request is unreviewable.** It gets rubber-stamped or closed. Either way there is no week two.

**Decision.** Ship drift detection first. `docgen baseline` writes zero docs. `docgen check` fails CI when a documented symbol changed and its doc did not. Backfill is opt-in, path-bounded, and framed as the noisy operation it is.

**Consequences.** The first release is smaller, less demo-able, and harder to market than "AI documents your repo." In exchange it produces recurring value on a cadence a reviewer can absorb, and each drift lands in the PR that caused it while the author still has the context. It also works with no API key, which removes the largest adoption barrier.

**Competitive note.** Drift detection is not empty space — Fiberplane Drift, `doc-drift`, Ducku, and a Claude Code drift-detection skill all exist. **All of them target prose, markdown, and READMEs. None does symbol-level docstring drift.** That is the open niche, and it may not stay open.

---

## ADR-002 — The AST owns structure; the LLM owns semantics

**Status:** accepted

**Context.** Every doc tool that lets the model emit comment markup ships malformed comments, hallucinated `@param` names, parameters in the wrong order, and broken insertion positions.

**Decision.** The model returns a validated JSON object of plain strings. The AST layer decides which tags exist, their names and order, and where the comment goes.

**Consequences.** Everything after the model call is deterministic and testable with no API key. Prompt changes cannot break file structure. The cost is that the model cannot express doc forms the renderer does not know about — `@example` bodies, for instance, need explicit support rather than falling out for free.

---

## ADR-003 — Token efficiency is not a design goal

**Status:** accepted

**Context.** The originating design optimized token cost throughout. The arithmetic: 5,000 symbols at ~700 input tokens is ~3.5M in, ~250K out — under $5 on a small model, roughly $15 on a mid-tier one, once. Even a deliberately wasteful agent loop lands in the low hundreds.

**Decision.** Do not optimize tokens as a headline. Spend context freely where it improves output. Report cost honestly and estimate before large runs, but never trade doc quality for tokens.

**Consequences.** This inverts the original premise, and the project's identity changes with it: docgen is a **context assembly engine that happens to emit docstrings**. Benchmarks, pitch, and feature set follow from that, not from cost-per-symbol. Model prices continue to fall, so any advantage built on cost has a short half-life.

---

## ADR-004 — Call graph for code context; embeddings only for prose

**Status:** accepted

**Context.** "Richer context via semantic search" is ambiguous between vector retrieval and type-aware graph traversal. For a typed language with a compiler available, similarity retrieval on code is actively harmful: querying `settleInvoice` returns `settleInvoiceBatch`, `unsettleInvoice`, `mockSettleInvoice` — maximally similar, maximally confusable, and the model merges them. The literature agrees that static analysis supplies explicit structural signals (types, dependencies, execution constraints) that overcome the limits of similarity-based retrieval; the two are complementary, not competing.

**Decision.** Code relations come from the type checker. Embeddings are reserved for unstructured prose — READMEs, ADRs, domain glossaries — where there are no edges to traverse.

**Consequences.** No vector store, no embedding pipeline, no index staleness for the code path. The cost is graph construction time and memory, which is why the index must be a single O(n) pass (ADR-010).

---

## ADR-005 — Generate in reverse topological order, feeding callee summaries upward

**Status:** accepted

**Context.** Published evaluation of LLM-generated Javadoc found 58.8% of comments equivalent to human-written and 27.7% superior — but its stated limitation is precisely our concern: *"LLMs struggled with minimal code contexts. Short, simple methods with few dependencies produced lower-quality documentation."* Separately, feeding a model a function's callees **and their docstrings** has been explored and reported as effective. Inlining callee bodies works but is expensive.

**Decision.** Document leaves first. A callee then contributes one generated line rather than forty lines of body. Cycles are condensed into SCCs and documented as units.

**Consequences.** Roughly 40x cheaper than body inlining, and the benefit compounds toward orchestration functions — exactly where minimal context fails hardest. Docs also become internally consistent, since callers describe callees in the callees' own words. The risk is error propagation: a wrong leaf summary contaminates everything above it, so leaves get the strictest judge pass. Generation is also no longer embarrassingly parallel — it is level-by-level.

---

## ADR-006 — Call sites, not caller bodies; direct human intent ranked first

**Status:** accepted

**Context.** Backward references carry *intent*, which is what a docstring needs and what a body cannot supply. But caller bodies are the worst point on the cost/value curve — large, mostly irrelevant, and about the caller rather than the callee. The signal is concentrated in a few tokens: argument names at the call site (`getUser(session.actorId, /* includeDeleted */ true)`), the variable the result is assigned to, and the enclosing function's name.

Test names are backward references too, and they are the single best value-per-token item available: `it("returns null when the user is soft-deleted")` is roughly twelve tokens of verified, human-written intent — it is already the docstring.

**Decision.** Send the call-site line +/-2 and the enclosing function name. Never send caller bodies. Rank directly attached source notes first when present, then test names, then the symbol's own body. Cap call sites at 2-5 and sample for module diversity, not first-N.

**Consequences.** Hub functions with hundreds of callers stay affordable. Repos with no tests lose the top context source and produce measurably weaker docs — that is a real limitation and should be said out loud in the README rather than hidden.

---

## ADR-007 — A post-hoc judge, not an `INSUFFICIENT_CONTEXT` self-report

**Status:** accepted

**Context.** The originating design had the model return `INSUFFICIENT_CONTEXT` when it could not document a symbol confidently. Models are bad at declining. Ask 2,000 functions "can you document this?" and you get roughly 2,000 confident, fluent, useless answers. That failure is silent, and silent failure is what ships. Models are, however, reasonably good at post-hoc judgment. The downstream stakes are real: incorrect documentation degrades later LLM task success by roughly 22.6 percentage points, and misleading comments drop LLM fault localization accuracy to 24.55%.

**Decision.** Generate with rich context, then run a cheap second pass asking whether the docstring states anything the signature does not. Reject means drop, not retry-with-more-context. `SKIP` remains available as a model output, but the judge — not the generator's self-assessment — is the real gate.

**Consequences.** Roughly 10-15% more spend, on the cheapest possible call, for the mechanism most likely to determine whether the tool is worth running. Some good docstrings will be rejected; that is the correct direction to err, because a missing docstring is neutral and a useless one is negative.

---

## ADR-008 — TypeScript compiler API (via ts-morph), not Tree-sitter

**Status:** accepted

**Context.** Tree-sitter is faster, incremental, and uniform across languages. It is also purely syntactic: it cannot resolve an import alias, follow a re-export, unwrap `Promise<T>`, or tell a type-only import from a value one. `ts-morph` has ~26M weekly downloads and is a safe foundation.

**Decision.** ts-morph for the TS/JS adapter, confined to `src/adapters/typescript/`. Reach for the type checker only where resolution genuinely requires it; prefer the syntax tree otherwise, for speed.

**Consequences.** Correct alias/re-export/overload handling. The cost is memory and time on very large programs, which is why type resolution is lazy and limited to symbols actually being documented. Tree-sitter remains a reasonable choice for future adapters where no comparable type-aware toolchain exists.

---

## ADR-009 — No type annotations in generated JSDoc

**Status:** accepted

**Decision.** Emit `@param invoiceId The invoice to settle`, never `@param {string} invoiceId ...`.

**Rationale.** TypeScript already carries the type, and it is checked. A type written into a comment is unchecked, duplicated, and will drift. TypeDoc handles untyped `@param` correctly.

**Consequences.** In `.js` files without checked types, the annotation would have carried information — so the JS-without-`checkJs` case is a documented exception where types may be emitted.

---

## ADR-010 — Symbol-level hashing with reverse-order edits, not a position-tracking state database

**Status:** accepted

**Context.** The originating design proposed a state database to track how insertions shift line numbers for later edits.

**Decision.** No such database. Apply edits in reverse document order — bottom-up insertion cannot invalidate positions above it. Reparse a file before applying only if its content hash changed since indexing, which covers concurrent modification. Persist only `.docgen/lock.json`: symbol hash and doc hash per stable symbol id.

Build the reverse index by inverting a single forward pass over call expressions, never by calling `findReferencesAsNodes()` per symbol.

**Consequences.** Substantially less state and one whole class of bug removed. The lockfile is a real artifact that must be committed, reviewed, and merged — merge conflicts in it are expected and need a documented resolution story.

---

## ADR-011 — Direct API batching, not an MCP tool interface

**Status:** accepted

**Context.** The originating design exposed generation through MCP `get_next_batch()` / `submit_batch()` so an agent could drive the loop.

**Decision.** The tool owns its own batching. Direct providers call their APIs;
optional CLI/SDK integrations are completion transports only. docgen still
assembles every prompt, validates semantic JSON, schedules batches, judges
results, chooses deterministic source spans, renders comments, and applies
edits. No external agent controls the pipeline or receives authority to select
or modify source spans. MCP may be added later as a thin wrapper for interactive
use.

**Rationale.** Putting an agent in the loop makes the run non-deterministic, unpriceable in advance, unrunnable in CI, and dependent on a client the CI runner does not have. The batching logic is not the hard part of this project and does not need delegating.

**Consequences.** Direct API providers remain the reliable unattended and CI
path. Subscription CLIs are opt-in local transports that inherit a user's
existing authentication, run ephemerally with tools disabled or read-only, and
may have unobservable allowance limits. No interactive "document this file
while I watch" experience in v1. That is a fine v2 feature and a bad v1
foundation.

---

## ADR-012 — Attached line comments are context; replacement is explicit and atomic

**Status:** accepted

**Context.** Undocumented code often has a short `//` note containing exactly the intent, invariant, or caveat a useful docstring needs. Ignoring it wastes human-written context. Treating every line comment as documentation, however, would capture implementation narration, TODOs, licenses, compiler directives, and tool controls; deleting those automatically is unsafe.

**Decision.** The TypeScript adapter deterministically captures only contiguous ordinary leading `//` groups attached to documentable declarations. They are labelled as untrusted source-note context and included in generation by default. The default write behavior is `preserve`. Users may opt into `docs.leadingComments.onGenerate: "replace"`; replacement is allowed only for a missing JSDoc, only for a structurally eligible group, and only as the same validated edit that applies an accepted generated JSDoc. Replacement requires the judge, so `judge.enabled: false` and `--no-judge` are invalid with this mode. The model supplies semantic strings but never selects or edits the source range.

Triple-slash references, shebangs, license headers, tool/compiler/coverage directives, trailing comments, detached comments, and comments inside declaration bodies are never replacement candidates. `SKIP`, judge rejection, schema failure, concurrent modification, or parse failure leaves the original group unchanged.

**Consequences.** Existing notes improve backfill quality and can be promoted without leaving duplicate comments. The feature remains destructive and therefore opt-in. Some useful comments will conservatively remain unconverted; that is preferable to deleting a non-documentation comment. Because replacement changes generation input, hashes are recomputed from the post-edit source before the lockfile is updated.

---

## ADR-013 — Monorepos are processed as configurable project partitions

**Status:** accepted

**Context.** Loading one type-checking program for a multi-million-line monorepo can require multiple gigabytes and makes the fast `check` path unpredictable. Running every package manually is operationally awkward, while forcing one lockfile policy does not fit both centrally owned and independently owned workspaces.

**Decision.** `workspace.projects` accepts `tsconfig.json` paths/globs and each match is an isolated processing unit. Projects run sequentially by default; `workspace.projectConcurrency` is an explicit memory/performance control. Duplicate source ownership is a configuration error. `workspace.lockfile` supports `shared` and `perProject`, and `--project` plus `--path` bound work without changing policy. Reports, failures, cost estimates, and `generate.maxSymbolsPerRun` aggregate across the selected workspace.

Cross-project graph edges are optional context, not a prerequisite for correctness. The single-project code path remains the primitive used for each partition.

**Consequences.** Large monorepos can trade throughput for bounded memory and choose lock ownership that matches team boundaries. Per-project lockfiles reduce merge contention but fragment workspace state; a shared lockfile simplifies CI reporting but conflicts more often. Rejecting overlapping ownership requires users to make project boundaries explicit.

---

## ADR-014 — Adapter-owned syntax hashes and explicit baseline replacement

**Status:** accepted

**Context.** Character-based whitespace removal erased regex spaces and ASI
boundaries. Variable callable signatures also omitted async and declared type
changes. Static and instance members could share an ID, and multiple variable
declarators shared an editable documentation span.

**Decision.** The TypeScript adapter supplies canonical syntax data, preserving
literal contents, operators, modifiers, and statement structure. Core hashes that
data without importing a parser. Instance IDs stay stable; static members add a
`:static` discriminator after any accessor discriminator. Multi-declaration
statements remain checkable but cannot receive automatic documentation edits.
Application also rejects overlapping edit spans and duplicate insertion points.

Lockfile schema 2 records project ownership for scoped orphan detection. Previous
schemas are rejected with instructions for an explicit reviewed rebaseline;
hashes and IDs are not silently migrated. `--project` selects within configured
projects and does not extend discovery. The complete configured workspace still
undergoes ownership validation.

**Consequences.** Existing users must review documentation before running
`baseline` on upgrade. Extraction no longer computes callable return types until
generation or rendering needs them. Post-edit lock entries come from final
formatted source while its bounded project is still loaded. These changes fix
TypeScript correctness without introducing the Phase 7 adapter framework.

---

## Sources

- [Mintlify Writer](https://github.com/mintlify/writer) — archived 2026-06-12
- [doc-comments-ai](https://github.com/fynnfluegge/doc-comments-ai) — archived 2026-02-16
- Package data via `registry.npmjs.org` and `api.npmjs.org/downloads`, retrieved 2026-08-27
- [An Exploratory Study on Using LLMs for Javadoc Generation](https://arxiv.org/abs/2408.14007) — 58.8% equivalent / 27.7% superior / 13.5% worse; minimal-context limitation
- [InlineCoder](https://arxiv.org/html/2601.00376) — bidirectional inlining: upstream callers for usage scenarios, downstream callees for dependency context
- [RepoScope](https://arxiv.org/pdf/2507.14791) — structure-based (callers + callees) fused with similarity-based context
- [Project Context for Code Summarization with LLMs](https://aclanthology.org/2024.emnlp-industry.65.pdf) — callees plus their docstrings as context
- [RAG for Code Generation: a survey](https://arxiv.org/html/2510.04905v1) — static analysis vs. similarity retrieval, and graph-construction cost
