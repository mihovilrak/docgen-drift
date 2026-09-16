# 1. Install, scope, and inspect

Start with the deterministic part of docgen. This page makes no model request.

## Prerequisites

- Node.js 20 or newer
- a TypeScript or JavaScript project described by `tsconfig.json`
- pnpm for the commands below; npm and Yarn users can invoke the installed
  `docgen` binary through their equivalent package runner

Install the package locally:

```bash
pnpm add -D docgen-drift
```

## Create the config

```bash
pnpm exec docgen init
```

A single-project repository can accept the defaults:

```text
TypeScript projects, comma-separated [tsconfig.json]:
Lockfile mode, shared or perProject [shared]:
Project concurrency [1]:
Created /workspace/project/.docgenrc.json for 1 project.
```

For a monorepo, enter comma-separated project globs such as
`packages/*/tsconfig.json, apps/*/tsconfig.json`. Start with concurrency `1`;
each concurrent project keeps a compiler program resident in memory. The
[monorepo guide](../monorepos.md) explains project selection and lockfile
placement.

## Define the public surface

The default policy considers syntactically exported declarations with bodies of
at least three lines. That is appropriate for an application. A library usually
benefits from entry-point-aware filtering:

```json
{
  "$schema": "https://unpkg.com/docgen-drift@1/schema/docgen.schema.json",
  "symbols": {
    "exportedOnly": true,
    "publicSurface": "entryPoints",
    "entryPoints": ["src/index.ts"],
    "minBodyLines": 3
  }
}
```

This follows exports and re-exports from the listed package entry points instead
of treating every internal module export as public API. Keep
`symbols.publicSurface: "syntacticExports"` when internal module exports are
intentionally part of the documentation policy.

## Inspect extraction

Count the extracted symbols:

```bash
pnpm exec docgen extract
```

```text
Extracted 140 symbols.
```

Use JSON when auditing exactly what the policy found:

```bash
pnpm exec docgen extract --json > docgen-symbols.json
```

Check a representative function, arrow function, class, interface, method, and
accessor. If the selection is noisy, adjust `include`, `exclude`, `symbols`, or
entry points before baselining. Do not use the baseline to hide a bad scope.

Exported non-function variables are excluded by default. To inspect them without
changing policy:

```bash
pnpm exec docgen extract --include-variables --json > docgen-symbols.json
```

## Inspect generation context without generating

Choose a symbol id from extraction and run:

```bash
pnpm exec docgen explain 'src/billing/settle.ts#settleInvoice'
```

The output can contain labelled source notes, test names, the symbol body, call
sites, referenced type fields, and a Git subject. It is assembled within the
configured token budget and does not construct a provider.

If the context is insufficient for a human to describe the behavior, improve
tests, source notes, project boundaries, or context configuration before using a
larger model. Generation cannot recover facts absent from the assembled input.

## Decide whether to generate

You can skip generation and continue directly to
[baseline and CI](03-baseline-and-ci.md). To backfill a small public area first,
continue to [generate a batch](02-generate-a-batch.md).
