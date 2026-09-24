# Changelog

## Unreleased

- Honor `Retry-After` (and Gemini `retryDelay`) when retrying; fail requests
  whose requested wait exceeds 60 seconds.
- Stop a run after `401`/`403`/`404`, an over-long rate-limit wait, or three
  consecutive `400`/`422` responses; remaining symbols are not sent.
- Show provider error text verbatim instead of rewording `400` responses.
- Add per-provider `requestsPerMinute` and per-run `requestsPerDay` pacing.
- Add Gemini 3.x prices.
- Note in the estimate when the judge uses the generation model.
- Reject `fix -p` paths outside `include`.

- Wrap rendered JSDoc at `docs.lineWidth` (default 80), letting a paragraph
  tail run to `docs.maxLineWidth` (default 90).
- Add direct OpenAI, Google Gemini, OpenAI-compatible, and subscription CLI
  provider transports with separate generation and judge selection.
- Add provider inspection, authentication preflight, short CLI flags, honest
  cost bases, context-window enforcement, and credential-free conformance tests.
- Add live generation and judge progress with detailed `--verbose` output and a
  `--quiet` mode that preserves final stdout.
- Add entry-point-aware package public-surface filtering while retaining
  syntactic-export policy.
- Add a quick guide, page-based adoption tutorial, and subscription CLI
  dogfooding report.
- Report unavailable subscription CLI token counts explicitly and use singular
  wording for one-symbol generation runs.
- Dogfood Codex CLI generation and judging on a bounded core symbol using the
  current ChatGPT-sign-in model family.
- Enforce configured documentation granularity during rendering so minimal and
  standard modes omit sections reserved for more detailed output.
- Judge and plan only the semantic documentation fields enabled by the selected
  granularity and tag configuration.
- Include granularity and enabled tags in the versioned generation contract so
  disabled fields are not requested or accepted.
- Classify Claude structured-output turn exits, allow three internal turns, and
  keep raw CLI diagnostics behind verbose or evaluation output.
- Add generation/judge stage metrics to JSON results and `--evaluation` JSON
  artifacts with semantic output, decisions, rendered comments, and source ids.
- Share one cacheable module outline per file across its generation and judge
  requests, charged against the per-symbol context budget, and order requests so
  a prefix is written once before it is read (`context.shared`).
- Document average per-symbol token cost and the caching model in the README.

## 1.0.0 - 2026-09-13

- Detect documentation drift per symbol with offline human, JSON, and SARIF
  reporting.
- Support TypeScript/JavaScript extraction, monorepo project boundaries, shared
  or per-project lockfiles, and diff-scoped checks.
- Generate and judge JSDoc through an explicit, path-bounded fix workflow.
- Add interactive configuration, published JSON Schema, cost estimates, CI and
  pre-commit recipes, and monorepo adoption guidance.
