# 2. Generate a reviewable first batch

Continue with `src/public-api.ts#highestScore` from page 1. Generation is optional;
it sends selected source context to the configured provider.

## Configure generation and judging

Merge these fields into the tutorial config for a direct Anthropic connection:

```json
{
  "generate": {
    "provider": { "kind": "anthropic" },
    "model": "claude-sonnet-5",
    "concurrency": 1,
    "maxSymbolsPerRun": 5
  },
  "judge": {
    "enabled": true,
    "model": "claude-haiku-4-5-20251001",
    "strictLeaves": true
  }
}
```

```bash
export ANTHROPIC_API_KEY="..."
pnpm exec docgen providers
pnpm exec docgen auth
```

Keep credentials out of configuration and version control. `auth` checks
credential presence, not validity or model access. Use models available to your
account. The [provider guide](../providers.md) covers other APIs, subscription
CLIs, and local servers, including explicit judge configuration.

Commit the configuration before the applying step below.

## Preview

These Bash commands keep diagnostic artifacts outside the repository:

```bash
preview_dir=$(mktemp -d)
pnpm exec docgen fix -m -p src/public-api.ts -n --verbose \
  --evaluation "$preview_dir/evaluation.json" \
  > "$preview_dir/preview.txt" 2> "$preview_dir/progress.log"
```

Open the files in `$preview_dir`. The preview contains the proposed diff plus
outcomes and counts. The log contains the estimate and progress. The evaluation
JSON records symbol IDs, proposed semantic documentation, judge decisions,
rendered comments, and aggregate stage metrics. It does not record complete
model prompts.

The estimate assumes typical output lengths and excludes retries; it is not a
spending cap. A preview makes real model calls even though it does not write
source files.

For this example, a useful proposal might be:

```ts
// Empty input has no maximum; keep zero as the display fallback.
/** Return the highest score, or zero when no scores are available. */
export const highestScore = (scores: readonly number[]): number => {
  if (scores.length === 0) return 0;
  return Math.max(...scores);
};
```

Wording and judge decisions vary. Confirm the comment describes the empty-input
behavior; reject claims such as ignoring invalid numbers that the code does not
implement. Ordinary source notes are preserved by default.

An accepted run ends with a line similar to:

```text
1 generated, 0 skipped, 0 rejected, 0 failed in 1 file; ...
```

`SKIP` and judge rejection are valid outcomes. If neither produces documentation,
you can write the example comment manually and continue.

## Generate and apply

Check that the working tree is clean, then run:

```bash
git status --short
pnpm exec docgen fix -m -p src/public-api.ts --verbose
```

This generates again; it does not apply the saved preview. It makes another
set of model calls and may produce different wording or decisions. Review the
actual source diff and run your project's checks before accepting it.

Edits must parse successfully. Ordinary comments are replaced only when
`docs.leadingComments.onGenerate: "replace"` is explicitly configured and the
replacement passes the required judge and structural checks. See the
[configuration reference](../config.md) for that opt-in behavior.

Next: [baseline and enforce drift checks](03-baseline-and-ci.md).
