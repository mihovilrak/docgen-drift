# Architecture

## The one invariant

> **The AST owns structure. The LLM owns semantics.**

The model never emits `/** ... */`, never emits `@param`, never sees or produces markup. It returns a small JSON object of plain strings. The AST layer decides what tags exist, in what order, with what names, and where the comment goes.

Everything downstream of this boundary is deterministic and unit-testable without an API key. Everything upstream is a prompt. Keep the boundary sharp — every doc tool that has let the model write the comment markup has shipped malformed comments, hallucinated parameters, and mangled insertions.

```text
discover -> index -> plan -> assemble -> generate -> judge -> apply
|________ deterministic ________|  LLM   |____ deterministic ____|
```

## Pipeline

### 1. discover

Resolve `tsconfig.json`, apply include/exclude globs, produce the file set. Excludes `node_modules`, build output, and declaration files by default.

In a monorepo, `workspace.projects` resolves multiple `tsconfig.json` files. Each project is an isolation boundary with its own compiler program; projects are processed at the configured concurrency, which defaults to one to bound peak memory. Include, exclude, and test globs are evaluated relative to each project root. A source file claimed by more than one configured project is a configuration error rather than being documented twice.

Test files are **not** excluded from *reading*. They are excluded from being *documented*. They are one of the most valuable context sources in the system.

### 2. index

One pass over the program builds every derived structure at once. This pass is the performance-critical part of the system; everything else is cheap by comparison.

Produces:

- **Symbol table** — one record per documentable symbol (see below)
- **Forward edges** — callee references, resolved from each body
- **Reverse index** — caller sites, built by inverting the forward edges
- **Test references** — call sites in files matching a test glob, with the enclosing `it` / `test` / `describe` string literals attached
- **Attached leading comments** — contiguous ordinary `//` comments associated with a declaration, captured separately from JSDoc and body comments

> **Never call `findReferencesAsNodes()` per symbol.** That is N language-service queries and it is where this design dies on a monorepo. Walk every call expression once, resolve each to a declaration, invert. O(n) instead of O(n x find-refs).

**Symbols that must be captured.** Naive implementations walk `FunctionDeclaration` and `MethodDeclaration` and stop, which misses `export const foo = () => {}` — the dominant style in modern TypeScript, and often the majority of a codebase's exported surface. The extractor must handle at minimum:

| Kind | Node |
| --- | --- |
| function | `FunctionDeclaration` |
| arrow / function expression | `VariableStatement` whose declaration initializes an arrow or function expression |
| method | `MethodDeclaration`, `MethodSignature` |
| accessor | `GetAccessorDeclaration`, `SetAccessorDeclaration` |
| class | `ClassDeclaration` |
| interface | `InterfaceDeclaration` |
| type alias | `TypeAliasDeclaration` |
| enum | `EnumDeclaration` |
| exported const | `VariableStatement` (non-function, when configured) |

Overloads collapse to the implementation signature and are documented once.

### 3. plan

Decides what work to do. This is where cost and noise are actually controlled.

- Compute each symbol's **content hash** (below) and compare against the lockfile
- Classify each symbol: `unchanged` / `drifted` (code hash moved, doc hash did not) / `missing` (no doc where policy wants one) / `orphaned` (doc recorded, symbol gone)
- Apply policy filters: exported-only, visibility, path scope, `@internal`, opt-out pragmas
- Mark eligible attached line-comment groups as replacement candidates only when the symbol has no JSDoc and `docs.leadingComments.onGenerate` is `replace`
- **Order the work in reverse topological order** over the call graph, so callees are documented before their callers

Cycles are condensed into strongly-connected components with Tarjan. An SCC is documented as a unit; inside it, callee summaries are unavailable, so members fall back to bodies.

### 4. assemble

Builds one context bundle per symbol under a token budget, filling a ranked knapsack. Attached leading comments are labelled as untrusted source notes, not model instructions. See [Context assembly](#context-assembly).

### 5. generate

Batched LLM calls. The model receives assembled context and returns, per symbol:

```jsonc
{
  "id": "src/billing/settle.ts#settleInvoice",
  "summary": "...",          // one sentence, imperative, must not restate the name
  "detail": "...",           // optional; only when it adds something
  "params": { "invoiceId": "...", "opts": "..." },
  "returns": "...",          // omitted when the return is genuinely self-describing
  "throws": [{ "type": "PaymentError", "when": "..." }],
  "verdict": "OK"            // or "SKIP" — a legitimate, expected, common answer
}
```

No markup. No types in `params` — TypeScript already carries the type, and `@param {string} name` is duplicated, unverified, and rots. TypeDoc reads untyped `@param` fine.

### 6. judge

A cheap second pass over generated output.

Models are poor at declining up front but decent at post-hoc judgment. So we do not ask *"do you have enough context?"* before generating. We ask *"does this docstring state anything the signature does not?"* afterward.

Rejected output is dropped, not retried with a bigger prompt. A docstring that adds nothing is a net negative: it consumes review attention and it will drift.

This gate is the difference between a tool that produces 2,000 fluent useless comments and one worth running.

### 7. apply

Renders the JSON into the target comment syntax and inserts it.

- **Apply edits in reverse document order.** Insertions shift every subsequent line; going bottom-up keeps recorded positions valid and removes the need for any position-tracking state.
- Reparse a file before applying if its hash changed since indexing — the repo can move under a long run.
- Preserve existing tags the tool does not own (`@deprecated`, `@example`, `@see`, `@internal`, custom tags). Merge, never clobber.
- With `docs.leadingComments.onGenerate: "replace"`, replace only the exact eligible leading-comment span captured during indexing. The replacement and JSDoc insertion are one edit; `SKIP`, judge rejection, validation failure, or a changed span leaves the original comments untouched. Replacement requires the judge and cannot be combined with `--no-judge`.
- Never replace triple-slash references, shebangs, license headers, tool directives (`@ts-`, ESLint, Prettier, Biome, coverage), trailing comments, detached comments, or comments inside a declaration body.
- Match surrounding indentation and the file's line endings.
- Format the result with the project's Prettier config if one resolves.
- Recompute the symbol and doc hashes from the post-edit file before updating the lockfile, including after a line-comment replacement.

## Content hashing

The unit of change detection is the symbol, not the file.

```text
symbol_hash = sha256(
  canonical_code         +  // adapter-owned syntax data; preserves literals and statement boundaries
  normalized_source_notes + // attached leading comments, only when enabled as context
  context_recipe_version +  // which context sources fed this doc
  prompt_version         +
  config_fingerprint        // doc-policy fields only, not include globs
)

doc_hash = sha256(normalized_docstring_text)
```

Both are stored in schema 2 `.docgen/lock.json`, keyed by a stable symbol id (`<repo-relative-path>#<container>.<name>`), never by line number. Static members add `:static` (after any accessor discriminator). Entries record project ownership for scoped orphan detection. Earlier schemas require an explicit reviewed rebaseline; see ADR-014.

**Drift** is:

```text
stored.symbol_hash != current.symbol_hash  &&  stored.doc_hash == current.doc_hash
```

The code changed, the doc did not. That single comparison is the product.

Reformatting must not trip it — hence normalization. Renaming a parameter must trip it — hence keeping parameter names in the normalized signature. Bumping `prompt_version` invalidates everything, deliberately.

## Context assembly

Two retrievers over two corpora, with no overlap:

- **Code relations -> the call graph.** Exact, resolved by the type checker.
- **Prose -> embeddings.** READMEs, ADRs, glossaries. Unstructured, no edges to traverse, similarity is the only handle.

Vector similarity is **not** used for code relations. For `settleInvoice` it returns `settleInvoiceBatch`, `unsettleInvoice`, `mockSettleInvoice` — maximally similar and maximally misleading, and the model conflates them. Similarity is a proxy for relatedness you only need when you cannot compute relatedness. With a type checker, we can.

### The budget

Fill until the per-symbol token budget is exhausted:

| # | Source | Notes |
| --- | --- | --- |
| 1 | Attached leading comments | Direct human-written intent for the symbol; labelled as source notes. |
| 2 | Test names referencing the symbol | ~12 tokens of verified human intent. |
| 3 | The symbol's own body | Truncated at a line cap with an elision marker |
| 4 | 2-5 call sites, line +/-2 | Argument names, the variable the result lands in, the enclosing function name |
| 5 | Callee generated summaries | One line each, available because of topological order |
| 6 | Referenced type declarations | **Fields only, not methods.** Depth 1. |
| 7 | `git log -L` commit subject | Intent-language. Quality varies by repo; configurable weight. |
| 8 | Callee bodies | Only the 1-2 dominant callees, only if budget remains |
| — | Caller bodies | Never. Worst point on the cost/value curve. |

Call sites are **sampled for module diversity**, not first-N. A hub function with 400 callers must not spend its whole budget on five near-identical lines from one file.

An attached comment is eligible only when it is a contiguous `//` group directly associated with a documentable declaration, allowing decorators but no blank-line separation. Eligibility is structural and deterministic. The model may use its text as evidence, but it never decides which source span to remove.

## Monorepo execution

Monorepos are processed as a sequence of bounded TypeScript projects, never as an implicit workspace-wide compiler program. `workspace.projects` accepts project-file globs, `workspace.projectConcurrency` controls how many programs may be resident, and `--project` can restrict a run. Reports and cost estimates aggregate across selected projects; `generate.maxSymbolsPerRun` is a workspace-wide cap, not a per-project multiplier.

`workspace.lockfile` is configurable:

- `shared` stores workspace-relative symbol ids in the root `.docgen/lock.json`, giving one CI artifact at the cost of more merge contention.
- `perProject` stores `.docgen/lock.json` beside each selected project, reducing contention and making package ownership explicit.

Cross-project call-graph edges are not required for the first implementation. Each project must remain useful in isolation; any context resolved through project references is additive. This bounds memory and prevents monorepo support from slowing the single-project `check` path.

### Why topological order matters

A callee contributes one generated line —

```text
settleLedgerEntry - marks entries settled and writes an audit row
```

— instead of forty lines of body. Roughly 40x cheaper, and it compounds: by the time generation reaches orchestration functions (exactly where minimal context fails hardest) every dependency already carries an English summary. It also makes the docs internally consistent, since callers describe callees in the callee's own words.

The cost: a wrong leaf summary propagates upward through the whole tree. Leaves are load-bearing, so the judge pass is applied to them strictly.

## Language adapters

TypeScript/JavaScript is the only implementation for now, but the pipeline is written against an interface so the second language is not a rewrite. **Nothing above the adapter layer may import `ts-morph`.**

```ts
interface LanguageAdapter {
  readonly id: string;                    // "typescript" | "python" | "go"
  readonly extensions: readonly string[];

  loadProject(root: string, cfg: Config): Promise<ProjectHandle>;
  extractSymbols(p: ProjectHandle): AsyncIterable<Symbol>;
  buildGraph(p: ProjectHandle, symbols: Symbol[]): Graph;  // forward + reverse edges
  renderDoc(doc: GeneratedDoc, sym: Symbol): string;       // JSDoc / docstring / godoc
  parseExistingDoc(sym: Symbol): ExistingDoc | null;
  applyEdits(p: ProjectHandle, edits: Edit[]): Promise<void>;
}
```

`Symbol`, `Graph`, `GeneratedDoc`, and `Edit` are language-neutral.

Per-language reality the interface must survive: Python has no static types to lean on and needs a style setting (Google / NumPy / reST); Go's convention starts the comment with the identifier name and has no tag vocabulary at all; the two place the comment inside vs. above the declaration differently. `renderDoc` owns all of that.

## Module layout

```text
src/
  cli/            # command parsing, output formatting, exit codes
  config/         # schema, load, merge, validate
  core/
    symbol.ts     # language-neutral Symbol / Graph types
    hash.ts       # normalization + content hashing
    lock.ts       # .docgen/lock.json read/write/migrate
    plan.ts       # classify, filter, topological order
    budget.ts     # ranked knapsack context assembly
  adapters/
    typescript/   # the only adapter. ts-morph lives here and nowhere else.
  llm/
    client.ts     # provider abstraction, retry, concurrency
    prompt/       # versioned prompt templates
    judge.ts      # the post-hoc value gate
  report/         # human, json, sarif output
```

## ts-morph traps

Each of these has already shipped in someone's doc tool:

- **`getSignature().getDeclaration().getText()` returns the entire function including the body.** Build the signature string from the declaration's name, type parameters, parameters, and return type node instead. Getting this wrong silently doubles the context of every symbol.
- **`getReturnType().isVoid()` is `false` for `async function f(): Promise<void>`** — the type is `Promise<void>`. Unwrap the awaited type before deciding whether `@returns` applies, or every async void function gets a junk return tag.
- **Referenced-type collection over-collects.** Walking every `Identifier` descendant of a type node picks up property names inside type literals and generic parameter names. Filter to identifiers that resolve to a type declaration outside the current node.
- **`.getType()` per parameter is expensive.** Over a large program it is the difference between seconds and hours. Resolve types lazily, and only for symbols actually being documented.
- **`exported` must be computed per declaration**, never assumed. Class methods are not all public API.
- Prefer the syntax tree; reach for the type checker only where alias resolution or re-export chasing genuinely requires it.

## Failure and safety

- `check` is read-only and never writes source files.
- `--fix` and `fix` refuse to run on a dirty working tree without `--allow-dirty`.
- Every write is validated: the file must reparse with no new syntax errors, or the edit is reverted and the symbol is reported as failed.
- Ordinary line comments are never removed unless `docs.leadingComments.onGenerate` is `replace`, the judge is enabled, the group passes deterministic eligibility checks, and accepted JSDoc is applied in the same validated edit.
- An LLM response that fails schema validation is retried once, then dropped. Never partially applied.
- Exit codes: `0` clean, `1` drift found, `2` configuration or usage error, `3` internal failure.
