# Phase 5 evaluation

Recorded: 2026-09-13.

## Corpus

`eval/phase5.json` contains 100 uniquely identified symbols and the original human-written documentation attached to each declaration:

| Repository | Commit | Symbols |
| --- | --- | ---: |
| microsoft/TypeScript | `c63de15a992d37f0d6cec03ac7631872838602cb` (`v5.9.3`) | 34 |
| dsherret/ts-morph | `c895bee3cca5b602b9d8a016804989faa2cefafa` (`28.0.0`) | 33 |
| vitest-dev/vitest | `9bd8d464e6328c567c2dbcd8fdd977d57a9425c2` (`v4.1.11`) | 33 |

The calibration mix contains 75 useful candidates grounded in the reference documentation and 25 signature-restating negative controls. Labels and judge decisions are stored per case so changes to metric code are reproducible and do not require an API key.

## Judge result

| Metric | Result |
| --- | ---: |
| Keep rate | 72.0% (72/100) |
| False-keep rate | 2.8% (2/72 kept) |
| False-reject rate | 6.7% (5/75 useful) |

This recorded calibration set has a false-keep rate below 10%; it does not
establish the quality of the current prompt or any currently configured model. The rate denominator is kept documentation because that is the material reviewers see. False-reject rate uses all human-useful candidates as its denominator.

## Context ablation

Each case has a manually recorded 1–5 quality score for a signature-only candidate and a candidate grounded in the full available behavioral context.

| Input | Mean quality |
| --- | ---: |
| Signature only | 1.10 |
| Full context | 3.77 |
| Improvement | +2.67 |

These are recorded scores, not a rerun of the current context assembler.
A current-model ablation requires new candidates and independent review.

## Comment promotion

The 16-case promotion set covers eight intent notes, three TODO/FIXME notes, two tool/compiler directives, and three implementation-narration notes.

| Metric | Result |
| --- | ---: |
| Useful-intent retention | 100% |
| Unsafe promotion rate | 0% |
| Noise rejection rate | 100% |

Deterministic extraction blocks directives before generation. The recorded decisions also reject TODOs and implementation narration; accepted intent cases retain the source note's behavioral constraint.

Run `pnpm eval:phase5` to validate the corpus and recompute all tables. This offline regression run does not call Anthropic. Current quality claims require a separate live evaluation with recorded model,
prompt version, inputs, outputs, and independent labels. That evaluation is not
performed by this script and should remain outside credential-free tests.
