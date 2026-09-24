# Review: JSDoc backfill of project-node (2026-09-23/24)

First real API-provider run of `docgen fix` on an external codebase: `project-node`, a TS/TSX full-stack monorepo of about 87k LOC. The run covered three projects: `api/`, `fe/` and `notification-service/`.

## Setup

| Project | Provider | Generate model | Judge model |
|---|---|---|---|
| `api/src` | Anthropic API | `claude-haiku-4-5-20251001` | `claude-haiku-4-5-20251001` |
| `fe/src/hooks`, `fe/src/components` | Anthropic API | `claude-haiku-4-5-20251001` | `claude-haiku-4-5-20251001` |
| other `fe/src` | OpenAI API | `gpt-5-mini` | `gpt-5-nano` |
| `notification-service/src` | Google (free tier), then OpenAI | `gemini-3.5-flash` / `gpt-5-mini` | `gemini-3.5-flash-lite` / `gpt-5-nano` |

- Command: `node --env-file=.env.docgen ../docgen/dist/cli.js fix --missing -a -c docgen-configs/<provider>.json -p <path> --evaluation <file>.json`
- Keys were kept in the gitignored `.env.docgen`. The configs reference env var names only.
- `leadingComments.onGenerate: "replace"` was used so that eligible `//` notes are replaced by the accepted JSDoc.
- A shell driver re-ran each path until it reported `0 failed` or made no progress.
- Budget was $5 each for Anthropic and OpenAI, plus the Gemini free tier.

## Result

`docgen check` after the run:

| Scope | Documented | Missing |
|---|---|---|
| `api` | 198 | 103 |
| `fe/src/api` | 83 | 10 |
| `fe/src/types` | 75 | 48 |
| `fe/src/hooks` | 45 | 4 |
| `fe/src/components` | 9 | 5 |
| `fe/src/utils`, `context`, `constants` | 21 | 0 |
| `fe/src/theme`, `setupTests.ts` | 0 | 2 |
| `notification-service` | 26 | 6 |
| **Total** | **457 (72%)** | **178** |

- All 178 missing symbols are judge rejections, except `setupTests.ts`, which was never run. Nothing is missing because of a provider failure.
- Most rejections were interfaces, props types and thin wrappers where the draft only restated the signature. This is the intended behavior of invariant 6: no doc is better than filler. It means the goal of "every function has JSDoc" is not reached on purpose.
- Diff: 152 files changed, +2529 / -293 lines. Replace mode removed 269 `//` lines.

### Remaining `//` comments

| Project | Total | In tests | Inside bodies | Top-level, non-test |
|---|---|---|---|---|
| `api/src` | 329 | 108 | 127 | 94 |
| `fe/src` | 1482 | 1352 | 111 | 19 |
| `notification-service/src` | 33 | 10 | 19 | 4 |

The remaining comments are not a bug. Replace mode only removes a leading note of a symbol that received accepted JSDoc (invariant 7). Test files are excluded, comments inside function bodies are never touched, and notes above rejected symbols stay. Removing the rest would need a separate, non-LLM cleanup pass. That is out of docgen's scope.

## Tokens and cost

| Provider | Runs | Accepted | Rejected | Failed | Input tokens | Output tokens | Cost |
|---|---|---|---|---|---|---|---|
| OpenAI (`fe`) | 10 | 165 | 120 | 3 | 599,755 | 638,461 | $0.591 |
| OpenAI (`notification-service`) | 2 | 22 | 15 | 1 | 51,015 | 88,700 | $0.075 |
| Anthropic | 3 | 246 | 112 | 0 | 966,944 | 68,287 | $1.308 |
| Google free tier | 2 | 1 (+1 SKIP) | 0 | 55 | 1,856 | 196 | $0 |
| **Total** | | **434** | **247** | | **1,619,570** | **795,644** | **$1.97** |

Notes on the table:
- Rejected counts include symbols retried in a second pass, so they overlap with each other.
- Not included: one aborted OpenAI `fe/src/types` run from before the judge token fix (cost not captured). There was also an initial Anthropic run of 296 requests that all failed on schema validation, with nothing billed.
- The budget was not a constraint. About 13% of the OpenAI budget and 26% of the Anthropic budget were used.

## Model comparison

| | gpt-5-mini + gpt-5-nano | Haiku 4.5 + Haiku 4.5 | gemini-3.5-flash (free) |
|---|---|---|---|
| Accept rate (first pass) | 58% | 69% | n/a |
| Cost per accepted doc | $0.0036 | $0.0053 | $0 |
| Output tokens per accepted doc | ~3,900 | ~280 | n/a |
| Median accepted doc size | ~330 chars | ~370 chars | n/a |
| SKIPs | 0 | 0 | 1 of 2 |
| Failures | reasoning-token exhaustion, schema 400 | none after Sonnet was dropped | 429 quota, 503 overload |

- **OpenAI** was the cheapest per accepted doc, even though output volume was ~14x higher. Almost all output tokens are hidden reasoning; the visible docs are the same size as Haiku's. Latency was noticeably higher. gpt-5-mini never returned SKIP, so the judge did all the filtering.
- **Haiku** was the most reliable: zero failures and the highest accept rate. Input-heavy cost comes from the context docgen sends. It judged its own output, so its accept rate is probably optimistic compared with the cross-model OpenAI pair. Its docs read slightly more concrete. Rejections were concentrated in `api/` controllers and models.
- **Sonnet** returned 429 on every request at this account's tier, so it was replaced by Haiku.
- **Gemini free tier** cannot handle a backfill. It allows about 5 requests/min and 20 requests/day per model, and each symbol costs 2 requests (generate + judge). It did produce the one clean SKIP and preserved a replaced note's rationale correctly. The rest of `notification-service` was finished with OpenAI.

## docgen issues found

Fixed during the run:
1. **Replace mode dropped the note's rationale.** The replaced `//` text now goes into the prompt as `replacesSourceNote`, and the prompt version was bumped (12d6cdc).
2. **Anthropic rejected `maxItems` in tool schemas.** It is now stripped for Anthropic (220ac76).
3. **GPT-5 judge output was empty.** Reasoning consumed `max_completion_tokens` at 1200, so 40 of 55 judge calls failed. This is fixed in config with `maxOutputTokens: 4000`, and documented in `docs/providers.md`.
4. **Destructured parameters broke generation.** Their raw binding text (`{ children }`) was used as the parameter name. That broke OpenAI strict schemas (`\n` in property keys) and made Anthropic write `@param {` tags. They are now named `rootN`, following the eslint-plugin-jsdoc convention (`extract/signature.ts`, with fixture `test/fixtures/destructured`). The four broken tags already written in project-node were fixed by hand.

Fixed after the run:
1. **Misleading error.** Provider error text is now shown verbatim (`openaiCompatible.ts`).
2. **No fail-fast on deterministic errors.** 400 and 404 were already not retried, but every remaining symbol still sent the same failing request. Now a `401`/`403`/`404` or three consecutive `400`/`422` responses stop the run, and remaining symbols fail with `Not sent after an earlier provider error` (`src/llm/call.ts`).
3. **`Retry-After` is ignored.** Retries now wait for `Retry-After` or Gemini's `retryDelay`. A wait over 60 seconds fails and stops the run instead of spending the quota.
4. **No cost table for `gemini-3.x`.** Added prices for 3.5 Flash/Flash-Lite, 3.1 Pro/Flash-Lite, 3 Pro and 3 Flash.
5. **`include` semantics are unclear.** `-p` narrows `include` and never extends it. A path with no checked symbols is now an error. Documented in `docs/config.md`.
6. **No quota-aware pacing.** Added per-provider `requestsPerMinute` and per-run `requestsPerDay` (`src/llm/pacing.ts`).
7. **Self-judging.** The estimate line now notes when the judge uses the generation model. `docs/providers.md` recommends a cross-model judge.

## Takeaways

- For a first backfill, `gpt-5-mini` with a `gpt-5-nano` judge (at `maxOutputTokens: 4000`) gives the best cost per accepted doc. Haiku 4.5 is the most reliable option. Gemini's free tier is only suitable for drift fixes of a few symbols a day.
- A 72% documentation rate with a strict judge is a better outcome than 100% with filler. The remaining 178 symbols are mostly self-describing types.
- The total spend for about 87k LOC was under $2.
