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

## Improvements recommended

1. Include granularity and enabled tags in the generation prompt, then increment
   `GENERATION_PROMPT_VERSION`, so providers do not generate discarded fields.
2. Detect Claude JSON-mode `tool_use` exits separately. If the installed CLI
   exposes a stable structured-output completion mode that needs more than one
   turn, adapt the invocation and add a conformance fixture before making these
   failures retryable.
3. Report provider failures without embedding large raw CLI usage objects in
   normal stdout. Keep the raw diagnostic under `--verbose` or a diagnostic
   file and show a short classified reason by default.
4. Add per-stage timing and final generation/judge counts to machine-readable
   output. Shell timing is sufficient for this report but should not be needed
   for routine evaluation.
5. Add an evaluation mode that records proposed semantic JSON, judge decisions,
   rendered comments, and source identifiers without requiring log scraping.

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
