import type { GenerationProgressEvent } from "./generate.js";

export interface ProgressStream {
  readonly isTTY?: boolean;
  write(value: string): unknown;
}

export interface GenerationProgressReporter {
  update(event: GenerationProgressEvent): void;
  finish(): void;
}

/**
 * Track generation and judge outcomes and render concise progress updates, with optional verbose diagnostics and TTY cleanup.
 * @param total Expected number of symbols to process.
 * @param verbose Whether to emit per-event provider details and diagnostics instead of compact aggregate progress.
 * @param stream Output stream for progress messages; defaults to standard error.
 */
export const createGenerationProgressReporter = (
  total: number,
  verbose: boolean,
  stream: ProgressStream = process.stderr,
): GenerationProgressReporter => {
  let generation = 0;
  let candidates = 0;
  let skipped = 0;
  let generationFailed = 0;
  let judged = 0;
  let accepted = 0;
  let rejected = 0;
  let judgeFailed = 0;
  let rendered = false;

  const update = (event: GenerationProgressEvent): void => {
    if (event.stage === "generation") {
      generation++;
      if (event.outcome === "OK") candidates++;
      if (event.outcome === "SKIP") skipped++;
      if (event.outcome === "FAILED") generationFailed++;
    } else {
      judged++;
      if (event.outcome === "ACCEPT") accepted++;
      if (event.outcome === "REJECT") rejected++;
      if (event.outcome === "FAILED") judgeFailed++;
    }

    if (verbose) {
      stream.write(`${verboseLine(event, generation, total, judged)}\n`);
      if (event.diagnostic !== undefined) {
        stream.write(`  diagnostic: ${diagnosticLine(event.diagnostic)}\n`);
      }
      return;
    }
    const line = `Progress: generation ${String(generation)}/${String(total)} (${String(candidates)} candidates, ${String(skipped)} skipped, ${String(generationFailed)} failed); judge ${String(judged)} (${String(accepted)} accepted, ${String(rejected)} rejected, ${String(judgeFailed)} failed)`;
    stream.write(stream.isTTY === true ? `\r\u001B[2K${line}` : `${line}\n`);
    rendered = true;
  };

  return {
    update,
    finish: () => {
      if (stream.isTTY === true && rendered) stream.write("\r\u001B[2K");
    },
  };
};

const verboseLine = (
  event: GenerationProgressEvent,
  generated: number,
  total: number,
  judged: number,
): string => {
  const position =
    event.stage === "generation"
      ? `${String(generated)}/${String(total)}`
      : String(judged);
  const detail =
    event.reason === undefined ? "" : ` — ${oneLine(event.reason)}`;
  return `[${event.stage} ${position}] ${event.symbolId} via ${event.provider}/${event.model}: ${event.outcome} after ${String(event.attempts)} attempt${event.attempts === 1 ? "" : "s"}${detail}`;
};

const oneLine = (value: string): string =>
  value.replace(/\s+/gu, " ").trim().slice(0, 300);

const diagnosticLine = (value: string): string =>
  value.replace(/\s+/gu, " ").trim().slice(0, 2_000);
