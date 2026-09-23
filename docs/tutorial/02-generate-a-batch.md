# 2. Generate a reviewable first batch

Generation is a fix path, not a prerequisite for drift checking. Start with one
file or a narrow public directory.

## Select a provider

Direct APIs are the predictable choice for CI or shared runners. Subscription
CLIs are convenient for a developer's local, attended run. Local models keep
source on the configured machine but must support JSON Schema constrained
output and should be evaluated for quality.

| Choice | Best fit | Cost reporting | Main caveat |
| --- | --- | --- | --- |
| Anthropic, OpenAI, or Google API | repeatable and unattended runs | estimated and actual USD for known models | requires an API credential |
| Claude, Codex, Gemini, OpenCode, or Pi CLI | local use with an existing login | subscription allowance | model access and limits depend on the installed CLI and account |
| OpenAI-compatible local server | controlled local deployment | unavailable | schema support, model quality, and context limits vary |

See the [provider guide](../providers.md) for complete configurations.

### Example: Claude subscription

```json
{
  "generate": {
    "provider": { "kind": "cli", "tool": "claude" },
    "model": "sonnet",
    "concurrency": 1,
    "maxSymbolsPerRun": 25
  },
  "judge": {
    "enabled": true,
    "model": "sonnet",
    "strictLeaves": true
  }
}
```

Sign in with the upstream CLI, then inspect docgen's effective configuration:

```bash
claude
pnpm exec docgen providers
pnpm exec docgen auth
```

`auth` checks only whether the executable exists. It deliberately does not read
CLI credentials or spend allowance. A successful result therefore does not
guarantee that the configured model is available; the one-symbol dry run below
is the final compatibility check.

### Example: direct Anthropic API

```json
{
  "generate": {
    "provider": { "kind": "anthropic" },
    "model": "claude-sonnet-5",
    "maxSymbolsPerRun": 25
  }
}
```

```bash
export ANTHROPIC_API_KEY="..."
pnpm exec docgen auth
```

The judge inherits the generation provider when `judge.provider` is omitted.
Configure it explicitly to use another service. Per-run `--provider` and
`--model` overrides affect generation only; the judge remains on its resolved
provider.

## Inspect one symbol's context

```bash
pnpm exec docgen explain 'src/core/diff.ts#unifiedDiff'
```

This is the prompt evidence, not the generated result. Confirm that it contains
the behavior a useful JSDoc should capture.

## Capture a one-file dry run

```bash
pnpm exec docgen fix --missing --path src/core/diff.ts --dry-run --verbose \
  --evaluation docgen-evaluation.json \
  > docgen-preview.diff 2> docgen-preview.log
```

The three files have separate purposes:

- `docgen-preview.diff` contains rejection/failure details, the proposed unified
  diff, and the final count.
- `docgen-preview.log` contains the estimate and generation/judge progress.
- `docgen-evaluation.json` contains source identifiers, semantic documentation,
  judge decisions, rendered comments, edit status, and stage timings.

The evaluation file is written atomically. In a dry run, an accepted comment
has `editStatus: "proposed"`; a real write uses `"written"`. Rejected output is
`"not-selected"`, while a validated candidate that could not be edited is
`"edit-failed"`.

An accepted run resembles:

```text
Estimated LLM use for 1 symbol: 5100 input tokens, 380 output tokens, drawn from a subscription allowance, no monetary cost available, including the judge; retries not included.
[generation 1/1] src/core/diff.ts#unifiedDiff via cli:claude/sonnet: OK after 1 attempt
[judge 1] src/core/diff.ts#unifiedDiff via cli:claude/sonnet: ACCEPT after 1 attempt — Adds behavioral information beyond the signature.
```

The diff file ends with a count similar to:

```text
1 generated, 0 skipped, 0 rejected, 0 failed in 1 file; ...
```

For CLI subscriptions, docgen can estimate prompt size but the upstream CLI may
not expose actual token counts or a monetary cost. Treat the account's own usage
page as authoritative.

## Review the proposal

Reject documentation that:

- restates the symbol name, parameters, or return type;
- claims behavior not supported by the body, tests, call sites, or source notes;
- exposes implementation details with no caller value;
- turns TODOs or temporary mechanics into API promises;
- is too long for the behavior it describes.

`SKIP` is a valid result. A missing comment is better than a fluent comment that
adds no information.

## Apply the same bounded batch

Ensure the working tree is clean, then remove `--dry-run`:

```bash
pnpm exec docgen fix --missing --path src/core/diff.ts --verbose
```

docgen reparses edited files and reverts an edit that introduces a syntax error.
It preserves ordinary comments by default. If
`docs.leadingComments.onGenerate` is `replace`, only structurally eligible
attached comments can be replaced, and only when the judge accepts the new
JSDoc in the same validated edit.

Review the real source diff and run the project's formatter, typecheck, and
tests. Repeat with another narrow path only after accepting the first batch's
quality.

Next: [baseline and enforce drift checks](03-baseline-and-ci.md).
