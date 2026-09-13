import { describe, expect, it } from "vitest";

import { checkExitCode, errorExitCode } from "../src/cli/errors.js";
import { SinceError } from "../src/cli/since.js";
import { ConfigError } from "../src/config/load.js";

describe("CLI exit codes", () => {
  it("maps clean, drift, usage, and internal outcomes to 0/1/2/3", () => {
    expect(checkExitCode(0)).toBe(0);
    expect(checkExitCode(1)).toBe(1);
    expect(errorExitCode(new ConfigError("bad config"))).toBe(2);
    expect(errorExitCode(new SinceError("bad ref"))).toBe(2);
    expect(
      errorExitCode(
        Object.assign(new Error("bad option"), { name: "CACError" }),
      ),
    ).toBe(2);
    expect(errorExitCode(new Error("unexpected"))).toBe(3);
  });
});
