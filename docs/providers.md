# Providers

`check`, `baseline`, `extract`, and `explain` never construct an LLM provider.
Only `fix` and `check --fix` use the provider configuration.

Use `docgen providers` to inspect the effective generation and judge models,
context limits, structured-output support, price basis, and credential variable
names. Use `docgen auth` for a no-request preflight: it checks only environment
variable presence or whether a configured CLI executable is on `PATH`.

## Direct APIs

Direct APIs are the recommended path for shared environments and unattended
CI because credentials, quotas, model availability, and usage accounting are
explicit.

### Anthropic

```json
{
  "generate": {
    "provider": {
      "kind": "anthropic",
      "apiKeyEnv": "ANTHROPIC_API_KEY",
      "maxOutputTokens": 1200
    },
    "model": "claude-sonnet-5"
  }
}
```

`baseUrl` is optional. docgen uses Anthropic JSON Schema structured output and
accounts separately for ordinary input, cache writes, cache reads, and output.

### OpenAI

```json
{
  "generate": {
    "provider": {
      "kind": "openai",
      "apiKeyEnv": "OPENAI_API_KEY",
      "baseUrl": "https://api.openai.com/v1",
      "maxOutputTokens": 1200
    },
    "model": "gpt-5-mini"
  }
}
```

The provider uses Chat Completions with strict `json_schema` response format.

GPT-5 models spend part of `maxOutputTokens` on hidden reasoning. At the
default 1200 the judge often returns no text and the symbol fails; use `4000`
for both the generation and judge providers.

### Google Gemini

```json
{
  "generate": {
    "provider": {
      "kind": "google",
      "apiKeyEnv": "GEMINI_API_KEY",
      "maxOutputTokens": 1200
    },
    "model": "gemini-3.6-flash"
  }
}
```

The provider uses `generateContent` with `responseJsonSchema`.

Tested on the free tier, which allows about 5 requests per minute and 20
requests per day per model for current Flash models. Each symbol costs one
generation and one judge request, so a free-tier day covers roughly 20 symbols
per model pair.
Use `concurrency: 1` and rerun `fix --missing` after `429` failures; completed
symbols are not regenerated.

## Separate generation and judge providers

The judge inherits `generate.provider` when `judge.provider` is omitted. Set it
explicitly to keep generation and judging on different services or models:

```json
{
  "generate": {
    "provider": { "kind": "openai" },
    "model": "gpt-5"
  },
  "judge": {
    "provider": { "kind": "google" },
    "model": "gemini-3.6-flash",
    "enabled": true
  }
}
```

`--provider` and `--model` are generation-only per-run overrides. They are
accepted only by `fix` and `check --fix`; configuration remains authoritative
for every other command. Overriding generation pins an inherited judge to the
provider it had before the override so an unrelated judge model is not silently
moved to another service.

## Local OpenAI-compatible servers

Experimental: implemented and covered by stubbed tests, not yet exercised
against a real codebase.

Ollama, LM Studio, llama.cpp, vLLM, and other servers are supported through the
same OpenAI-compatible transport:

```json
{
  "generate": {
    "provider": {
      "kind": "openai-compatible",
      "baseUrl": "http://127.0.0.1:11434/v1",
      "contextWindowTokens": 32768,
      "maxOutputTokens": 1200,
      "timeoutMs": 120000
    },
    "model": "qwen3-coder"
  },
  "judge": {
    "provider": {
      "kind": "openai-compatible",
      "baseUrl": "http://127.0.0.1:1234/v1",
      "contextWindowTokens": 16384
    },
    "model": "separate-judge-model"
  }
}
```

Add `apiKeyEnv` when the server requires a bearer token. docgen never assumes a
local model's context window: set `contextWindowTokens` to the loaded model's
actual limit. If omitted, the conservative fallback is 8192 tokens. When
`context.budgetTokens` is too large, docgen reduces it before the run and says
so in the estimate; it does not rely on server-side truncation.

The selected server and model must accept Chat Completions
`response_format.type: "json_schema"`. A rejection is reported as a capability
error. Unconstrained prose is not accepted as a local-model fallback because
the semantic response contract is part of edit safety.

Local generation quality is model-specific. Passing the response schema proves
format conformance, not documentation quality. Run the Phase 5 evaluation on
the exact model, quantization, context window, and hardware before using it for
a broad backfill, and record those details with the result.

Common base URLs:

| Server | Typical base URL |
| --- | --- |
| Ollama | `http://127.0.0.1:11434/v1` |
| LM Studio | `http://127.0.0.1:1234/v1` |
| llama.cpp | `http://127.0.0.1:8080/v1` |
| vLLM | `http://127.0.0.1:8000/v1` |

Confirm the URL and JSON Schema support against the installed server version.

## Subscription CLI transports

The Claude and Codex CLI transports are tested. Gemini, OpenCode, and Pi CLI
transports are experimental.

CLI transports invoke only an executable already installed by the user and
inherit its existing login. docgen never reads, copies, refreshes, or prints the
CLI's credential files.

```json
{
  "generate": {
    "provider": { "kind": "cli", "tool": "claude" },
    "model": "sonnet"
  },
  "judge": {
    "provider": { "kind": "cli", "tool": "claude" },
    "model": "sonnet"
  }
}
```

Supported `tool` values are `claude`, `codex`, `gemini`, `opencode`, and `pi`.
`command` may name a non-default executable, `args` prepends wrapper-specific
arguments, and `timeoutMs` bounds each completion.

For Codex and other CLIs without a stable account-wide model alias, set
`generate.model` and `judge.model` to an identifier confirmed by the installed
CLI and the signed-in account. API model availability does not imply that the
same identifier is enabled through a subscription login. Run a one-symbol dry
run after `docgen auth`; the preflight checks executable presence only and does
not validate remote login, model entitlement, schema support, or allowance.

For example, this bounded configuration used the current fast Codex model in
September 2026:

```json
{
  "generate": {
    "provider": { "kind": "cli", "tool": "codex" },
    "model": "gpt-5.6-luna",
    "concurrency": 1
  },
  "judge": {
    "enabled": true,
    "provider": { "kind": "cli", "tool": "codex" },
    "model": "gpt-5.6-luna"
  }
}
```

OpenAI's [Codex model page](https://developers.openai.com/codex/models) is the
source of truth for ChatGPT-sign-in models. `gpt-5.3-codex` is deprecated for
that sign-in method even though it remains listed in the API model catalog.
Availability can still vary by plan, rollout, sign-in method, and client.
See the [subscription CLI dogfooding report](cli-dogfooding-report.md) for a
measured Claude run, the stale-model failures, and a successful Codex run on the
same bounded target.

These integrations are completion transports, not autonomous docgen drivers.
docgen still selects symbols, assembles context, batches requests, validates
semantic JSON, judges results, chooses source spans, renders JSDoc, and applies
validated edits. The subprocess receives one prompt at a time. Built-in tools
are disabled or placed in read-only/plan mode. Claude, Codex, and Pi use their
ephemeral modes. Gemini receives a temporary deny-all admin policy; its and
OpenCode's reported completion sessions are deleted after the process exits.
The result fails if safe cleanup cannot be confirmed.

CLI output formats and account allowances are controlled upstream. Usage is
reported as `subscription allowance`; docgen does not invent a dollar value or
claim unused allowance is free. Missing executables, login requirements,
exhausted limits, unsupported models, malformed output, cancellation, and
timeouts fail without applying a partial response.

Claude structured output may use more than one internal turn to satisfy the
requested JSON Schema. The transport permits up to three turns while keeping
tools disabled and sessions ephemeral. A `tool_use` or maximum-turn exit is
classified separately and remains non-retryable, so docgen does not spend a
second allowance automatically. This follows Claude Code's
[CLI `--json-schema` and `--max-turns` contract](https://code.claude.com/docs/en/cli-usage).

Generation writes concise progress counters to stderr. Pass `--verbose` for a
line per generation and judge result, including the symbol, provider, model,
outcome, attempt count, and bounded raw diagnostics on failure. Normal progress
shows only the classified failure. Pass `--quiet` to suppress the estimate and
progress; the final human or JSON result remains on stdout. The flags are
mutually exclusive.

Subscription access remains governed by each upstream provider's current terms
and plan limits. Do not share or resell accounts or allowances. Use direct API
credentials for shared runners, services, and unattended CI unless the
provider's terms and deployment controls explicitly permit the CLI workflow.

## Credential safety

- Put the environment-variable name in config, never the secret value.
- Do not commit `.env` files or provider credential stores.
- Give CI a scoped secret only in a generation job. Drift-only jobs need none.
- Run `docgen auth` to check presence or executable discovery; it makes no model
  request and does not validate or expose secret contents.
- Treat `baseUrl` as a trust boundary. Prompts contain selected source context.

## Cost and tokens

Known direct models report estimated and actual USD usage from docgen's price
table. Unknown direct models and OpenAI-compatible servers report `cost
unavailable`. CLI transports report subscription allowance. Mixed generation
and judge bases collapse to unknown instead of producing a misleading partial
dollar total.

Providers may expose a local tokenizer. Otherwise docgen uses a conservative
lexical fallback and may include less context than the remote tokenizer would
allow. It never makes a token-count API request for every candidate context
span.

## Troubleshooting

`Provider ... requires ... to be set` means the configured credential
environment variable is absent. Set it in the current process or choose a CLI
transport.

`does not support JSON Schema constrained output` means the local server or
selected model rejected strict structured output. Choose a compatible model or
server version; docgen will not silently weaken the contract.

`is not installed or not on PATH` means `docgen auth` or the transport could not
resolve the executable. Set `command` only when the binary has a different name
or absolute path.

Login, allowance, and unsupported-model messages come from classified CLI
stderr. Run that CLI interactively once to establish authentication or inspect
its model list, then retry `docgen auth` and a bounded dry run.

For unexpected output, run the upstream CLI's own version command and compare
its documented non-interactive JSON mode. CLI output contracts can change
independently of docgen; direct APIs are the stable fallback.
