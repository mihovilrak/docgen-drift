# Subscription CLI dogfooding report

Recorded: 2026-09-16.

## Scope

The run targeted one missing exported symbol:

```text
src/core/diff.ts#unifiedDiff
```

Using one symbol kept the comparison bounded and gave both providers the same
signature, body, and assembled context. The initial comparison used `--dry-run`;
stdout was redirected to a diff file under `/tmp`, stderr to a separate progress
file, and shell timing to a third file. After correcting the Codex model, one
bounded non-dry run applied the accepted JSDoc and wrote its lock entry.

Environment:

| Component | Version or setting |
| --- | --- |
| docgen | `1.0.0`, invoked from source with `pnpm exec tsx src/cli.ts` |
| Node.js | `22.22.1` |
| pnpm | `12.4.1` |
| Claude Code | `2.1.272` |
| Codex CLI | `0.154.0` |
| Context budget | 2,000 tokens per symbol |
| Generation concurrency | 1 |
| Judge | enabled, same CLI as generation |

The pre-run estimate was the same for both providers:

```text
Estimated LLM use for 1 symbols: 5100 input tokens, 380 output tokens, drawn from a subscription allowance, no monetary cost available, including the judge; retries not included.
```

That estimate covers one generation and one judge completion. It is a planning
upper bound, not measured subscription usage.

## Claude result

Configuration:

```json
{
  "generate": {
    "provider": { "kind": "cli", "tool": "claude" },
    "model": "sonnet",
    "concurrency": 1
  },
  "judge": { "enabled": true, "model": "sonnet" }
}
```

Result:

| Measurement | Value |
| --- | ---: |
| Wall time | 46.55 s |
| Generation attempts | 1 |
| Judge attempts | 1 |
| Outcome | accepted |
| Changed files in proposed diff | 1 |
| Source writes | 0 |

Progress:

```text
[generation 1/1] src/core/diff.ts#unifiedDiff via cli:claude/sonnet: OK after 1 attempt
[judge 1] src/core/diff.ts#unifiedDiff via cli:claude/sonnet: ACCEPT after 1 attempt
```

The proposal correctly documented behavior not visible in the signature:

- identical inputs return an empty string;
- the implementation keeps the longest common prefix and suffix;
- output is limited to the changed span with three surrounding context lines;
- `path` is rendered in `a/` and `b/` headers and is not read from disk.

The JSDoc was structurally valid and grounded in the body. It was longer than
necessary for a small internal utility: the summary, detail paragraph, and
return text repeated parts of the same algorithm. A `minimal` granularity or a
stricter concision instruction would fit this kind of symbol better. This is a
review preference, not a correctness failure.

## Initial Codex failures

The first Codex attempts did not reach a successful completion, and docgen
reported zero model calls for each failure.

| Attempt | Model | Wall time | Result |
| ---: | --- | ---: | --- |
| 1 | `gpt-5` | 15.36 s | sandbox prevented Codex from initializing its state directory |
| 2 | `gpt-5` | 21.60 s | after granting the CLI its state-directory access, ChatGPT-account model access was rejected |
| 3 | `gpt-5.3-codex` | 30.68 s | ChatGPT-account model access was also rejected |

The first process failure was environmental and occurred before remote model
use. The two model-name failures also ended before a completion and were reported
as:

```text
0 generated, 0 skipped, 0 rejected, 1 failed in 0 files; 0 input tokens, 0 output tokens, no model calls.
```

The installed executable passed `docgen auth` because that command checks only
that `codex` is on `PATH`. The remote account still rejected both model ids.
The initial investigation consulted the API catalog, which lists
[`gpt-5.3-codex`](https://developers.openai.com/api/docs/models/gpt-5.3-codex),
instead of the separate Codex model page for ChatGPT sign-in. The latter states
that `gpt-5.3-codex` is deprecated for this authentication path.

This is not a source-edit safety issue: the failures produced no diff and no
partial edit. It is an onboarding and preflight limitation.

## Successful Codex correction

The current [Codex model documentation](https://developers.openai.com/codex/models)
recommends the GPT-5.6 family. The retry used `gpt-5.6-luna`, which is intended
for fast, clear, repeatable tasks.

```json
{
  "generate": {
    "provider": { "kind": "cli", "tool": "codex" },
    "model": "gpt-5.6-luna",
    "concurrency": 1,
    "maxSymbolsPerRun": 1
  },
  "judge": {
    "enabled": true,
    "provider": { "kind": "cli", "tool": "codex" },
    "model": "gpt-5.6-luna"
  }
}
```

| Measurement | Value |
| --- | ---: |
| Wall time | 73.84 s |
| Generation attempts | 1 |
| Judge attempts | 1 |
| Outcome | accepted and applied |
| Changed source files | 1 |
| Lock entries written | 1 |

```text
[generation 1/1] src/core/diff.ts#unifiedDiff via cli:codex/gpt-5.6-luna: OK after 1 attempt
[judge 1] src/core/diff.ts#unifiedDiff via cli:codex/gpt-5.6-luna: ACCEPT after 1 attempt
1 generated, 0 skipped, 0 rejected, 0 failed in 1 file; token counts unavailable, subscription allowance (no monetary cost available).
```

The resulting check reported:

```text
0 drifted, 202 missing, 0 orphaned, 13 unchanged.
```

The failure was therefore stale model selection, compounded by consulting the
API catalog instead of the Codex subscription-model documentation. The Codex
transport, JSON Schema output, response parsing, judge, source application, and
lock refresh all worked with the supported model.

## Product findings

### 1. CLI preflight is necessary but not sufficient

`docgen auth` accurately checks executable discovery without touching credential
files or spending allowance. Its success can still be mistaken for verified
login and model access.

Documentation now states that a one-symbol dry run is the end-to-end provider
probe. A future opt-in command such as `docgen auth --probe` or `docgen doctor`
could make one minimal structured-output request and distinguish executable,
login, model entitlement, allowance, and schema-support failures. It must be
clearly labelled as consuming allowance.

### 2. Hard-coded subscription model examples age badly

The provider guide used `gpt-5` in a Codex CLI example. That model was rejected
by the installed CLI with a ChatGPT account, and `gpt-5.3-codex` was already
deprecated for ChatGPT sign-in. Subscription examples should use the current
Codex model page rather than API availability and should still require a bounded
compatibility test.

### 3. Successful CLI usage renders measured tokens as zero

Claude's successful final line reported `0 input tokens, 0 output tokens`
because the CLI transport does not expose token telemetry. Zero reads as a
measurement even though two completions occurred. The human report should say
`token counts unavailable` for that case while retaining the pre-run estimate.

### 4. Singular output is grammatically rough

The estimate said `1 symbols`, and the result said `1 files`. These small issues
are especially visible in the recommended one-symbol safety workflow.

### 5. Failure classification was useful

docgen distinguished initialization failure from unsupported-model failure,
kept stderr bounded, reported the affected symbol, and produced no partial
output. `--verbose` supplied enough provider, model, stage, outcome, and attempt
information to diagnose the run without exposing credentials.

## Changes made from the findings

- Added a [quick guide](quick-guide.md) and a
  [page-based tutorial](tutorial/index.md) with one-symbol dry runs, stdout/stderr
  capture, provider caveats, expected output, safety notes, and CI adoption.
- Updated the provider guide with the successful `gpt-5.6-luna` configuration
  and the distinction between API and ChatGPT-sign-in model availability.
- Clarified that CLI `auth` checks executable presence, not remote login, model
  entitlement, or remaining allowance.
- Updated human generation output to use singular nouns and report unavailable
  CLI token telemetry honestly.
- Applied the accepted Codex-generated JSDoc to `src/core/diff.ts` and wrote its
  lock entry.

## Follow-up recommendations

1. Add an explicit opt-in remote provider probe with a stated allowance cost.
2. Record upstream CLI versions in verbose diagnostics or a future `doctor`
   report.
3. Preserve the current one-symbol path workflow as the recommended first live
   test.
4. Run the Phase 5 evaluation before recommending any CLI model as a default;
   successful schema output is not a quality result.
