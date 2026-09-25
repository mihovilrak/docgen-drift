# 4. Operate and troubleshoot providers

Provider failures affect generation only. The baseline and drift-check workflow
remains available while a provider is unavailable.

## Inspect before spending allowance

```bash
pnpm exec docgen providers
pnpm exec docgen auth
```

`providers` prints effective generation and judge models, context and output
limits, structured-output capability, cost basis, and credential source.
`auth` makes no model request:

- direct providers check that the configured environment variable exists;
- CLI providers check that the executable is on `PATH`;
- neither command validates account quota or model entitlement.

Follow them with a dry run against one file. That is the smallest end-to-end
test of authentication, model availability, structured output, schema parsing,
generation, judging, and diff rendering.

## Common failures

### The CLI exists but generation says login is required

Run the upstream CLI interactively and complete its own login flow. docgen does
not read or refresh credential files. Retry `docgen auth`, then the one-file dry
run.

### The configured model is unsupported

CLI model availability is controlled by the installed CLI, account, plan, and
upstream rollout. A model accepted by a direct API or shown in general model
documentation is not necessarily enabled for a subscription login.

Use the upstream CLI's current model selector or official documentation to find
an account-supported identifier, put that exact value in both `generate.model`
and `judge.model` when both use the same CLI, and retry one bounded dry run.
Avoid relying on a copied model name without testing it.

For Codex, check the current
[Codex model page](https://developers.openai.com/codex/models) rather than the
API model catalog. As of September 2026, ChatGPT-sign-in configurations should
use the GPT-5.6 family; `gpt-5.3-codex` is deprecated for that authentication
path.

### `auth` succeeds but the first model call fails

This is expected when the executable is present but login, entitlement, quota,
or the model name is invalid. The no-request preflight cannot prove remote
availability. The generation result should report zero generated files and no
partial source edit.

### Subscription output reports no dollar amount

docgen does not invent a price for subscription allowance. Use the provider's
account UI for remaining limits and billing. Estimates are conservative planning
figures; retries are excluded.

### A local server rejects structured output

The selected model and server must accept Chat Completions with
`response_format.type: "json_schema"`. Upgrade or choose a compatible server and
model. docgen does not fall back to unconstrained prose because schema-valid
semantic output is part of edit safety.

### Generation timed out

Increase the provider's `timeoutMs` only after checking that the upstream
process is actually making progress. Keep `generate.concurrency` at `1` for
subscription CLIs until the installed tool and account behavior are measured.

### Claude exits with `tool_use` or a turn-limit error

Claude may need several internal turns to produce JSON that satisfies the
schema. docgen allows three turns, disables tools, and reports this exit as a
structured-output turn-limit failure. It does not retry automatically because
another CLI process would spend more allowance. Capture one bounded run with
`--verbose --evaluation <path>` and inspect the diagnostic before retrying.

### The judge rejects useful output

Run with `--verbose` and inspect its reason. Improve the selected context or
source evidence first. `--no-judge` is available for a deliberately manual
review, but it increases filler risk and is forbidden when attached line
comments are configured for replacement.

### The working tree is dirty

An applying fix refuses to start so a failed or unwanted generation is easy to
separate from other work. Commit or stash unrelated changes. `--allow-dirty` is
an explicit override, not a normal tutorial step.

## Separate generation and judging

The judge may use a cheaper or different provider:

```json
{
  "generate": {
    "provider": { "kind": "anthropic" },
    "model": "claude-sonnet-5"
  },
  "judge": {
    "enabled": true,
    "provider": { "kind": "google" },
    "model": "gemini-2.5-flash"
  }
}
```

Run `providers` and `auth` again after changing either role. Per-run provider or
model overrides change generation only, so explicit configuration is clearer
when testing a generation/judge pair.

## Capture a diagnostic run

```bash
preview_dir=$(mktemp -d)
pnpm exec docgen fix -m -p src/public-api.ts -n --verbose \
  --evaluation "$preview_dir/evaluation.json" \
  > "$preview_dir/preview.txt" 2> "$preview_dir/progress.log"
```

Record:

- docgen and upstream CLI versions;
- configured generation and judge provider/model pairs;
- selected symbol count and estimate;
- wall time;
- generation, skip, reject, and failure counts;
- generation/judge requests, attempts, outcomes, and timings from the
  evaluation artifact;
- the first actionable error, without credential contents.

Do not attach provider credential stores, environment dumps, or prompts that
contain proprietary source unless the recipient is authorized to see them.

Return to the [tutorial index](index.md) or use the
[provider reference](../providers.md) for all supported transports.
