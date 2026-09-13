# AGENTS.md

Guidance for AI Agents working in this repository. ALWAYS return short summaries at the end of responses. NEVER write your thoughts and verbose coding comments. ONLY comment what isn't obvious from the code alone.

## What this is

`docgen` — symbol-level documentation drift detection for TypeScript/JavaScript, with LLM-assisted regeneration as the fix path. **Drift detection is the product; generation is the `--fix` flag.** If a change makes bulk generation nicer at the expense of `check` being fast, precise, and LLM-free, it is the wrong change.

Read [ARCHITECTURE.md](ARCHITECTURE.md) before writing code in `src/`. Read [DECISIONS.md](DECISIONS.md) before proposing a design change — several obvious-looking ideas were considered and rejected there for reasons that are not obvious.

Current state: pre-implementation. [PLAN.md](PLAN.md) is the build order; work the phases in sequence.

## Commands

```bash
pnpm build          # tsup
pnpm test           # vitest
pnpm test -- --watch
pnpm lint           # eslint + prettier --check
pnpm typecheck      # tsc --noEmit

node ./dist/cli.js check --json     # run the CLI from a build
```

## Invariants — do not break these without an ADR

1. **The AST owns structure, the LLM owns semantics.** The model returns JSON with plain strings. It never produces `/** */`, `@param`, or any markup. If you find yourself parsing model output as JSDoc, stop.
2. **`ts-morph` is imported only inside `src/adapters/typescript/`.** Nothing in `core/`, `cli/`, `llm/`, or `report/` may import it, directly or transitively. This is what makes Phase 7 possible. Enforce with a lint rule.
3. **`check` never writes source files and never calls an LLM.** It must run offline in CI in seconds.
4. **Edits apply in reverse document order.** Bottom-up insertion keeps earlier positions valid.
5. **Hashing is per symbol, keyed by a stable id — never by line number.**
6. **`SKIP` is a valid, expected model output.** Never coerce it into a docstring. A docstring that restates the signature is worse than none.
7. **Ordinary comments are preserved by default.** Replacement requires explicit configuration, deterministic eligibility, and accepted JSDoc applied atomically. The LLM never chooses a source span to delete.
8. **Monorepo work is project-bounded.** Do not build an implicit workspace-wide compiler program; honor configured project concurrency and aggregate limits.

## Code conventions

- ESM only, Node >= 20, `strict` TypeScript. No `any` in `core/`.
- Prefer cohesive modules around 150 lines, with 200 lines as a soft upper bound. A larger module is acceptable when splitting it would break the logic or make it less readable.
- Prefer arrow functions over function declarations in JavaScript and TypeScript.
- Avoid overengineering. Use the simplest design that satisfies the current phase and invariants; add abstractions only for a concrete need.
- Errors: return typed results from `core/`, throw only at the CLI boundary. The CLI maps errors to exit codes 0/1/2/3.
- No default exports.
- Anything deterministic gets a unit test against `test/fixtures/`. Do not mock `ts-morph` — run it on real fixture files.
- LLM calls are stubbed in tests. There must be zero tests that require an API key.
- Keep prompts in `src/llm/prompt/` as versioned files. Editing a prompt means bumping `prompt_version`, which invalidates every hash — that is intentional, so do it deliberately.

## ts-morph traps

These have each shipped as bugs in other doc tools. The full list with explanations is in [ARCHITECTURE.md](ARCHITECTURE.md#ts-morph-traps).

- `getSignature().getDeclaration().getText()` returns the **whole function including the body**. Build signatures from the declaration's parts.
- `getReturnType().isVoid()` is `false` for `async (): Promise<void>`. Unwrap the awaited type.
- Walking `FunctionDeclaration` + `MethodDeclaration` only **misses `export const f = () => {}`**, which is most of a modern codebase. Every extraction change needs a fixture covering it.
- `findReferencesAsNodes()` per symbol is O(n x find-refs) and will not scale. Build the reverse index by inverting a single forward pass.
- `.getType()` is expensive; call it lazily and only for symbols being documented.

## Writing docs about the docs

This tool's own source is a fair test subject, but do not run `docgen fix` on this repo until Phase 5 exists. Dogfooding a generator with no quality gate is how the tool ends up full of the exact filler it is supposed to prevent.

## Tone for user-facing output

Terse and factual. Report counts, not encouragement. When a run produces nothing, say so plainly. No emoji in CLI output.
