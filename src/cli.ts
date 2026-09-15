#!/usr/bin/env node

import { errorExitCode } from "./cli/errors.js";
import { assertNoShortFlagCollisions } from "./cli/options.js";
import { createProgram } from "./cli/program.js";

try {
  const cli = createProgram();
  assertNoShortFlagCollisions(cli);
  cli.parse(process.argv, { run: false });
  await cli.runMatchedCommand();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Unknown internal error"}\n`,
  );
  process.exitCode = errorExitCode(error);
}
