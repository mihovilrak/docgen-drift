# Tutorial: adopt documentation drift checks

This tutorial takes a TypeScript project from installation to an enforced,
LLM-free drift check. Generation is optional and remains a local fix workflow.

## Pages

1. [Install, scope, and inspect](01-install-and-scope.md)
2. [Generate a reviewable first batch](02-generate-a-batch.md)
3. [Baseline and enforce drift checks](03-baseline-and-ci.md)
4. [Operate and troubleshoot providers](04-providers-and-troubleshooting.md)

The pages are independent after installation. Use the
[quick guide](../quick-guide.md) when you only need the command sequence.

## End state

At the end, the repository contains:

```text
.docgenrc.json
.docgen/
  lock.json
```

The config defines the documentation policy. The lockfile records symbol and
JSDoc hashes. Both are versioned project artifacts. Pull requests run
`docgen check`; a maintainer runs generation only when drift needs a proposed
fix or when a bounded area is intentionally backfilled.

## Safety model

- `check`, `baseline`, `extract`, and `explain` never call an LLM.
- `check` never writes source files.
- Missing-doc backfill requires an explicit `--path`.
- Fixes refuse a dirty working tree unless `--allow-dirty` is given.
- Dry runs print a diff without writing it.
- The model returns semantic JSON; docgen renders and validates JSDoc.
- `SKIP`, schema failure, judge rejection, or validation failure leaves the
  source unchanged.

Generation is not the adoption boundary. A team can use drift detection without
ever configuring a model provider.
