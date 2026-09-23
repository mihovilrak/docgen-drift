# Live directory runs: Codex on `src/cli`, Claude on `src/core`

Recorded: 2026-09-16.

## Scope

This report supersedes the earlier two-symbol dry-run comparison. Both runs
were real source-writing runs with the judge enabled:

```bash
pnpm exec tsx src/cli.ts fix -m -p src/cli --allow-dirty --verbose \
  -c .docgenrc.codex-live.json

pnpm exec tsx src/cli.ts fix -m -p src/core --allow-dirty --verbose
```

Codex generated and judged with `cli:codex/gpt-5.6-luna`. Claude generated and
judged with `cli:claude/sonnet`. Both used concurrency `1`, standard
granularity, a 2,000-token context budget, and the shared lockfile. No
`--dry-run` or `--no-judge` flag was used.

Raw captures:

```text
/tmp/docgen-codex-cli-live.txt
/tmp/docgen-codex-cli-live-stderr.txt
/tmp/docgen-codex-cli-live-time.txt
/tmp/docgen-claude-core-live.txt
/tmp/docgen-claude-core-live-stderr.txt
/tmp/docgen-claude-core-live-time.txt
```

## Results

| Measurement | Codex: `src/cli` | Claude: `src/core` |
| --- | ---: | ---: |
| Selected symbols | 32 | 45 |
| Estimated input tokens | 163,200 | 229,500 |
| Estimated output tokens | 12,160 | 17,100 |
| Generated and applied | 23 | 18 |
| Generation `SKIP` | 2 | 0 |
| Judge rejections | 7 | 23 |
| Failed | 0 | 4 |
| Changed source files | 13 | 9 |
| Wall time | 928.57 s | about 1,216 s |

The Claude timing capture contains the malformed value `real 1216.:0`; it still
establishes a duration of approximately 20 minutes 16 seconds. Codex took 15
minutes 29 seconds. Subscription transports do not expose reliable aggregate
token counts or monetary cost, so the table reports docgen's pre-run estimates.

The shared `.docgen/lock.json` now contains the 23 accepted CLI symbols and 18
accepted core symbols from these runs. The previously generated
`src/core/diff.ts#unifiedDiff` entry remains separate from this comparison.

## Codex review

Codex returned 30 schema-valid documentation candidates and two deliberate
`SKIP` results. Every generation and judge call completed on its first attempt.
The judge accepted 23 and rejected seven.

The skips were appropriate:

- `SinceError` was only a conventional `Error` subclass in the supplied
  context.
- `PreflightResult` exposed only self-describing fields.

The judge rejected data-shape comments for `ProjectIndex`, generation result
interfaces, generation options, and the estimate interface because they merely
rephrased fields. It also caught a factual error in `runInit`: the generated
documentation claimed an atomic write, while the implementation directly uses
exclusive file creation.

The accepted function comments were generally concise and behavior-oriented.
Strong examples include changed-line filtering, exit-code classification,
generation estimates, lock refresh, workspace indexing, and dependency-ordered
generation. The review pass tightened comments whose useful behavior had been
placed only in a discarded detail field, notably provider inspection, progress
rendering, project scoping, and the two generation orchestration functions.

## Claude review

Claude proposed documentation for every selected symbol rather than using
`SKIP`. Of 45 symbols, the judge accepted 18, rejected 23, and four failed. The
high rejection rate came mostly from interfaces where generation invented
rationale or restated field names.

The judge caught several concrete problems:

- `normalizeDoc` falsely claimed tag order was normalized even though array
  order affects the hash.
- `SourceNote` invented normalization and delimiter-preservation behavior.
- `Edit` asserted reverse-order application without that evidence appearing in
  the supplied symbol context.
- several interfaces inferred architectural intent from field names alone.

The accepted set was much stronger on functions with observable algorithms:
Tarjan SCC partitioning, deterministic reverse topological ordering, atomic
lock writes, typed lock reads, in-flight Git lookup memoization, call-site
sampling, greedy context packing, symbol hashing, and classification.

Four Claude requests exited with code 1 and `stop_reason: "tool_use"` despite
the transport passing `--tools ""`, plan permission mode, one maximum turn, and
no session persistence:

- judge: `LockError`
- judge: `ContextSources`
- generation: `normalizeCode`
- generation: `assembleContext`

Docgen treated all four as failures and did not write their documentation. This
is safe but reduces batch reliability. The failure was not retryable under the
current CLI error classification.

## Cross-provider findings

The directories differ, so acceptance rate is not a controlled model-quality
benchmark. `src/core` contains many exported data interfaces, while `src/cli`
contains more behavior-rich orchestration functions. Even so, the run exposes
useful operating differences:

- Codex used `SKIP` for context-poor declarations; Claude generated candidates
  for all of them and relied on the judge to remove filler.
- Both judges caught unsupported factual claims.
- Codex had no transport failures in 62 generation/judge completions.
- Claude had four `tool_use` exits across 88 attempted generation/judge
  completions.
- Claude's accepted algorithm comments were detailed and accurate, but its
  interface generation was speculative.
- The judge prevented 30 low-value or incorrect comments from reaching source
  across both runs.

## Product defect found: judge/output mismatch

The earlier granularity fix correctly stopped `standard` mode from rendering
`detail` and `throws`. These live runs exposed a second-order defect: the judge
still evaluated the full generated object. It could therefore accept a
candidate because of useful detail that the renderer then discarded.

Examples included `emptyLock` and `CallSite`, whose initial rendered summaries
lost the exact facts cited by the judge. Their source comments were revised to
retain those facts.

The pipeline now projects generated documentation through the configured
granularity and tag settings before judging and planning edits:

| Configuration | Fields visible to judge and renderer |
| --- | --- |
| `minimal` | summary |
| `standard` | summary, enabled params, enabled returns |
| `detailed` | summary, detail, enabled params, enabled returns, enabled throws |

An integration test verifies that standard-mode judging sees returns but not
detail or throws. This avoids acceptance based on text that cannot reach the
source file. Generation can still spend tokens producing disabled fields; a
future prompt-version change should tell the model which fields are enabled.

## Recommendation implementation

Implemented on 2026-09-16 without another Claude or Codex model request:

1. Generation prompt version `2` names the active granularity and tags. Its
   response schema requires disabled fields to be null or empty.
2. Claude now receives a three-turn bound for schema completion. JSON
   `tool_use` and maximum-turn exits have a dedicated, non-retryable
   classification covered by a deterministic transport fixture.
3. Normal progress contains a short classified provider error. Full subprocess
   output is retained as a diagnostic and shown only by `--verbose`, JSON, or an
   evaluation artifact.
4. Machine-readable generation results include total duration and per-stage
   requests, attempts, outcomes, and elapsed time.
5. `--evaluation <path>` atomically records proposed semantic documentation,
   judge decisions, rendered comments, edit status, source identifiers,
   provider/model identities, prompt version, output policy, usage, and timing.

The implementation has deterministic provider, prompt/schema, progress,
metrics, and evaluation coverage. Live validation is intentionally deferred
because the Claude allowance was exhausted and the Codex allowance was low.

## Source review and validation

All accepted comments were reviewed after application. Wording was tightened
where the accepted semantic object relied on detail omitted by standard mode.
Rejected, skipped, and failed candidates did not modify source. The temporary
Codex run configuration was removed after the run.

Final validation:

```text
33 test files passed
172 tests passed
TypeScript typecheck passed
ESLint and Prettier checks passed
Production build passed
git diff --check passed
```

The final offline check reports 28 unchanged and 9 missing symbols in `src/cli`,
plus 21 unchanged and 27 missing symbols in `src/core`. It reports no drifted or
orphaned symbol in either directory.

## Live model validation

Run on 2026-09-22 after the user confirmed allowances. One Claude pass and two
Codex passes were issued; the first Codex pass failed before any model produced
text and is reported below as a defect, not as a model-quality result.

### Claude pass — `src/llm/outputPolicy.ts`

```text
3 generation requests, 3 attempts, 0 skipped, 0 failed, 31.9s
3 judge requests, 2 accepted, 1 rejected, 0 failed, 40.2s
run duration 85.9s; 2 written, 1 not-selected
```

Checklist results: `promptVersion` is `2:1`; the artifact records `detail: false`
and `throws: false` for standard granularity; stage counts match the three
records; both accepted records report `editStatus: "written"` and the rejected
record reports `"not-selected"` with no source change; no rendered comment
contains a `@throws` or detail section. No request exited with `tool_use`, so
the three-turn bound resolved the earlier schema-completion failures. Token
counts are unavailable on the subscription allowance.

### Codex pass — `src/cli/generationMetrics.ts`

The first pass failed all five generation requests before any sampling, with
HTTP 400 `invalid_json_schema`: `In context=('properties', 'throws', 'items'),
schema must have a 'type' key`. Standard granularity disables `throws`, and the
disabled-field branch emitted `{ type: "array", maxItems: 0, items: {} }`. An
empty item schema is accepted by the Claude transport and rejected by OpenAI
structured output, so recommendation 1 had shipped a provider-specific break
that no deterministic test covered.

The branch now reuses the Zod-derived item schema and only adds `maxItems: 0`.
A regression test walks the portable schema for both `throws` settings and
asserts every `items` subschema carries a `type`. The fixed schema was confirmed
against the Codex validator with a throwaway request before the pass was
repeated. `maxItems` itself is accepted. The prompt text is unchanged and the
parser already forced `throws` empty under the policy, so the generation prompt
version was deliberately not bumped: no model-visible instruction or accepted
output space changed, and a bump would invalidate every stored hash.

Second pass:

```text
5 generation requests, 5 attempts, 0 skipped, 0 failed, 52.8s
5 judge requests, 1 accepted, 4 rejected, 0 failed, 30.0s
run duration 96.9s; 1 written, 4 not-selected
```

`promptVersion` is `2:1`, the output policy matches standard granularity, stage
counts match the five records, and the four rejected records left source
unchanged.

### Comment quality

Claude's two accepted comments state non-obvious behavior: the `returnsValue`
guard that suppresses the returns section, and the asymmetry by which disabled
`params`/`throws` are emptied while disabled `detail`/`returns` are omitted.
Both were verified against the bodies and kept.

The judge rejected all three metrics interfaces in the Codex pass for restating
field names, which is the correct call for those declarations. It accepted
`addJudgeStages` while rejecting the structurally identical
`addGenerationStages` for the same class of summary. The accepted comment is the
weaker of the two outcomes and sits at the edge of the restatement bar; it was
kept, but the pair is direct evidence that the judge is not stable across
near-identical symbols. Judge determinism on sibling symbols is worth a
follow-up before any bulk run.

### Not a benchmark

The two passes documented different files with different symbol mixes:
`outputPolicy.ts` is one interface plus two functions with real branching, while
`generationMetrics.ts` is three field-only interfaces plus two reducers. The
acceptance rates (2/3 and 1/5) reflect that difference in symbol shape far more
than any provider difference. These runs are transport and artifact validation,
not a controlled model-quality comparison.

### Final validation

```text
34 test files passed
180 tests passed
TypeScript typecheck passed
ESLint and Prettier checks passed
Production build passed
git diff --check passed
```

The offline check moved from 12 unchanged / 175 missing to 15 unchanged /
172 missing, with 42 drifted and 0 orphaned unchanged in both runs. The three
newly documented symbols account for the whole difference.

### Measured basis for bulk-run cost

Per-symbol wall clock at `concurrency: 1`, generation plus judge: 28.6s
(Claude/sonnet) and 19.4s (Codex/gpt-5.6-luna). The tool's own pre-run estimate
is 5,100 input and 380 output tokens per symbol at a 2,000-token context budget
with the judge enabled. Eight `claude -p` requests that surfaced raw usage
reported a mean of 15,373 input tokens and $0.0695 per request, roughly three
times the estimate, because the CLI transport adds its own system prompt and
reasoning tokens. Metered-API runs should be costed from the estimator; CLI
subscription runs report no monetary cost at all.
