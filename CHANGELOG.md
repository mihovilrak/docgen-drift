# Changelog

## Unreleased

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

## 1.0.0 - 2026-09-13

- Detect documentation drift per symbol with offline human, JSON, and SARIF
  reporting.
- Support TypeScript/JavaScript extraction, monorepo project boundaries, shared
  or per-project lockfiles, and diff-scoped checks.
- Generate and judge JSDoc through an explicit, path-bounded fix workflow.
- Add interactive configuration, published JSON Schema, cost estimates, CI and
  pre-commit recipes, and monorepo adoption guidance.
