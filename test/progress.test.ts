import { describe, expect, it } from "vitest";

import {
  createGenerationProgressReporter,
  type ProgressStream,
} from "../src/cli/progress.js";
import type { GenerationProgressEvent } from "../src/cli/generate.js";

describe("generation progress", () => {
  it("renders concise generation and judge counters", () => {
    const output = capture(false);
    const reporter = createGenerationProgressReporter(2, false, output.stream);

    reporter.update(event("generation", "OK"));
    reporter.update(event("judge", "REJECT", "Only restates the signature."));
    reporter.finish();

    expect(output.text()).toContain("generation 1/2 (1 candidates");
    expect(output.text()).toContain("judge 1 (0 accepted, 1 rejected");
  });

  it("renders per-symbol provider details in verbose mode", () => {
    const output = capture(false);
    const reporter = createGenerationProgressReporter(2, true, output.stream);

    reporter.update(event("generation", "OK"));
    reporter.update(event("judge", "ACCEPT", "Adds supported behavior."));

    expect(output.text()).toContain(
      "[generation 1/2] src/api.ts#leaf via cli:claude/sonnet: OK after 1 attempt",
    );
    expect(output.text()).toContain(
      "[judge 1] src/api.ts#leaf via cli:claude/sonnet: ACCEPT",
    );
    expect(output.text()).toContain("— Adds supported behavior.");
  });

  it("clears an in-place TTY status when finished", () => {
    const output = capture(true);
    const reporter = createGenerationProgressReporter(1, false, output.stream);

    reporter.update(event("generation", "SKIP"));
    reporter.finish();

    expect(output.text()).toMatch(/^\r\u001B\[2KProgress:/u);
    expect(output.text()).toMatch(/\r\u001B\[2K$/u);
  });
});

const event = (
  stage: GenerationProgressEvent["stage"],
  outcome: GenerationProgressEvent["outcome"],
  reason?: string,
): GenerationProgressEvent => ({
  stage,
  symbolId: "src/api.ts#leaf",
  provider: "cli:claude",
  model: "sonnet",
  outcome,
  attempts: 1,
  ...(reason === undefined ? {} : { reason }),
});

const capture = (isTTY: boolean) => {
  let value = "";
  const stream: ProgressStream = {
    isTTY,
    write: (chunk) => {
      value += chunk;
    },
  };
  return { stream, text: () => value };
};
