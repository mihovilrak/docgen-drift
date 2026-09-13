# docgen

**Symbol-level documentation drift detection for TypeScript and JavaScript.** Catches docstrings that stopped being true. Regenerates them on demand.

Not a "document my whole repo with AI" button. Those exist, several were well funded, and all of them are archived (see [DECISIONS.md](DECISIONS.md#adr-001)). The failure mode was never cost or quality — it was that a 2,500-docstring pull request is unreviewable, so it gets rubber-stamped or closed, and nothing brings the user back a second week.

docgen inverts that. The default workflow produces **zero** docstrings on day one.

## The workflow

```bash
docgen baseline          # record what exists today. writes no docs. no LLM calls.
docgen check             # CI gate: fail when a documented symbol changed but its doc didn't
docgen check --fix       # regenerate only the docs that drifted
```

`baseline` is the adoption path. You accept the docs you have, and from that moment forward the build fails when someone changes `settleInvoice` without touching the comment that describes it. Drift arrives one or two symbols per PR — a reviewable amount — and each one lands in the PR that caused it, where the author still has the context in their head.

Backfilling undocumented symbols is a separate, opt-in, deliberately noisy operation:

```bash
docgen fix --missing --path src/api    # bounded by path. review it like code.
```

For a large monorepo, configure package `tsconfig.json` files as separate projects and backfill one path at a time. Projects are processed sequentially by default so several compiler programs are not held in memory at once; lockfiles may be shared at the workspace root or kept per project.

An ordinary leading `//` comment can be useful source material even though it is not JSDoc. Attached line-comment groups are included in LLM context by default. They are preserved unless `docs.leadingComments.onGenerate` is explicitly set to `"replace"`; in that mode, an eligible group is atomically replaced only after generated JSDoc passes validation and the judge. Directives, licenses, trailing comments, and comments inside a body are never replacement candidates.

## What makes the docstrings worth reading

A docstring that restates the signature is worse than no docstring — it costs review attention and goes stale. Documentation quality tracks the context the model was given, and the published failure mode is minimal context: *"LLMs struggled with minimal code contexts. Short, simple methods with few dependencies produced lower-quality documentation."*

So docgen is, structurally, a **context assembly engine** that happens to emit docstrings. For each symbol it assembles, in descending value-per-token:

1. **Attached leading comments** — often the closest thing an undocumented symbol has to an intent statement
2. **Test names** that reference the symbol — `it("returns null when the user is soft-deleted")` is already the docstring
3. The symbol's own body
4. **Call sites** (the line ±2), not caller bodies — argument names and the variable the result lands in
5. **Callee summaries**, generated first — docs are produced in reverse topological order, so every dependency already has an English one-liner
6. Referenced type declarations, fields only
7. The commit subject that introduced the symbol (`git log -L`)

And it is allowed to say nothing. `SKIP` is a first-class model output, and a second cheap pass judges whether the produced docstring says anything the signature didn't. Silence beats filler.

## Status

Pre-alpha. Nothing is implemented yet. See [PLAN.md](PLAN.md) for the build order and [ARCHITECTURE.md](ARCHITECTURE.md) for the design.

TypeScript and JavaScript first, via the TypeScript compiler API. Python and Go are planned behind a language adapter interface (see [ARCHITECTURE.md](ARCHITECTURE.md#language-adapters)) but no adapter beyond TS/JS will be written until the TS path is genuinely good.

## Non-goals

- **Token efficiency as a headline.** 5,000 symbols is a few dollars. Optimizing that is optimizing the wrong axis; rich context is worth paying for. Cost is a constraint, not a feature.
- **Generating prose documentation sites.** Docstrings live next to code. Markdown drift is a different, more crowded problem.
- **Letting the model write JSDoc syntax.** The model returns semantic strings. The AST layer renders and inserts them. See [ADR-002](DECISIONS.md#adr-002).
