# Performance and cost

`check` does not create a model provider or resolve return types for rendering.
Project loading, extraction, public-surface resolution, and hashing still take
time. `--since` filters findings after indexing; it is not incremental compilation.

Project concurrency controls the number of loaded compiler programs. Generation
skips projects without targets after ownership validation. Git-context lookups
share a run-wide limit equal to `generate.concurrency`. Source-line indexes and
syntax data are cached for a file revision, and edited files supply their updated
lock entries without a third workspace load.

## Model estimates

The current estimate assumes 300 generation output tokens and 80 judge output
tokens per symbol, plus context and prompt overhead. It excludes retries.
Longer output, provider reasoning tokens, or additional attempts can exceed the
estimate. Prices come from the configured provider's capabilities; unknown and
subscription costs are reported without a fabricated dollar total.

Dry-run output is not a saved generation plan. Running again without `--dry-run`
makes new requests and can change the proposals.

## Shared context and caching

When a file has enough selected symbols, its shared module outline lists sibling
declarations. The outline uses part of `context.budgetTokens`; per-symbol context
shrinks accordingly. Both generator and judge receive it.

Requests with the same prefix are issued in a lead wave and a follower wave.
This gives a cache-capable provider an opportunity to store the prefix before
concurrent readers arrive. Providers without cache controls inline the same
context. Minimum cacheable lengths, expiry, and prices vary; a shared prefix
does not guarantee a discount. Treat caching as an optimization, not a cost cap.

## Measurement

Use `scripts/benchmark-extraction.ts single <tsconfig>` for load/extract timing,
or `graph <tsconfig>` for the graph stage too. Compare the same checkout and
environment, run without concurrent test workers, and report wall time and peak
RSS with file/symbol counts. See [benchmarks](benchmarks.md) for historical runs.

### Pre-release cleanup measurement

A local comparison of dependency-level construction on the same star graph
(10,000 symbols, 9,999 edges, two levels) took 2,115 ms with the previous code
and 158 ms with component adjacency. This single synthetic sample measures that
algorithm only, not end-to-end CLI throughput.

The repository benchmark after cleanup measured 4,645 ms for loading and
extraction (379 MiB peak RSS), and 9,596 ms including graph construction
(432 MiB). The earlier graph run measured 9,085 ms, but the checkout grew from
112 files / 571 symbols to 119 files / 580 symbols during this work. Return-type
queries also moved out of extraction, shifting checker startup into the graph
stage. These runs do not establish an end-to-end speedup; larger-repository
measurements are still needed.
