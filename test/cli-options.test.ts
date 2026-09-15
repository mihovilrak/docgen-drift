import { cac } from "cac";
import { describe, expect, it, vi } from "vitest";

import { assertNoShortFlagCollisions } from "../src/cli/options.js";
import { createProgram } from "../src/cli/program.js";
import { ConfigError } from "../src/config/load.js";

/**
 * cac echoes the raw single-letter keys alongside the camelCase ones, and mri
 * only back-fills them for some spellings. Compare the named options.
 */
const parse = (...argv: readonly string[]): Record<string, unknown> => {
  const cli = createProgram();
  cli.parse(["node", "docgen", ...argv], { run: false });
  return Object.fromEntries(
    Object.entries(cli.options).filter(([key]) => key.length > 1),
  );
};

const commandHelp = (name: string): string => {
  const cli = createProgram();
  const command = cli.commands.find((candidate) => candidate.name === name);
  if (command === undefined) throw new Error(`No ${name} command`);
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  try {
    command.outputHelp();
    return info.mock.calls.map((call) => String(call[0])).join("\n");
  } finally {
    info.mockRestore();
  }
};

const EQUIVALENT: readonly (readonly [
  command: string,
  short: readonly string[],
  long: readonly string[],
])[] = [
  ["extract", ["-j", "-c", "x.json"], ["--json", "--config", "x.json"]],
  ["explain", ["foo", "-j"], ["foo", "--json"]],
  ["providers", ["-j", "-c", "x.json"], ["--json", "--config", "x.json"]],
  ["auth", ["-j"], ["--json"]],
  ["baseline", ["-c", "x.json"], ["--config", "x.json"]],
  [
    "check",
    ["-j", "-s", "main", "-P", "packages/*", "-f", "-n", "-a"],
    [
      "--json",
      "--since",
      "main",
      "--project",
      "packages/*",
      "--fix",
      "--dry-run",
      "--allow-dirty",
    ],
  ],
  [
    "fix",
    ["-m", "-p", "src", "-P", "packages/*", "-n", "-a", "-j", "-c", "x.json"],
    [
      "--missing",
      "--path",
      "src",
      "--project",
      "packages/*",
      "--dry-run",
      "--allow-dirty",
      "--json",
      "--config",
      "x.json",
    ],
  ],
];

describe("cli option aliases", () => {
  it.each(EQUIVALENT)(
    "parses %s short flags identically to their long forms",
    (command, short, long) => {
      expect(parse(command, ...short)).toEqual(parse(command, ...long));
    },
  );

  it("declares no short flag twice on the same command", () => {
    expect(() => {
      assertNoShortFlagCollisions(createProgram());
    }).not.toThrow();
  });

  it("rejects a short flag reused within one command", () => {
    const cli = cac("docgen");
    cli
      .command("check [root]", "")
      .option("-p, --path <path>", "")
      .option("-p, --project <path>", "");

    expect(() => {
      assertNoShortFlagCollisions(cli);
    }).toThrow(ConfigError);
  });

  it("rejects a command short flag that shadows a global one", () => {
    const cli = cac("docgen");
    cli.option("-c, --color", "");
    cli.command("check [root]", "").option("-c, --config <path>", "");

    expect(() => {
      assertNoShortFlagCollisions(cli);
    }).toThrow(/-c is declared twice on "check"/u);
  });

  it("shows both forms in command help", () => {
    const help = commandHelp("check");

    for (const raw of [
      "-c, --config <path>",
      "-j, --json",
      "-s, --since <ref>",
      "-P, --project <path-or-glob>",
      "-f, --fix",
      "-n, --dry-run",
      "-a, --allow-dirty",
    ]) {
      expect(help).toContain(raw);
    }
  });

  it("keeps safety-sensitive and uncommon flags long-only", () => {
    const check = commandHelp("check");
    const extract = commandHelp("extract");

    expect(check).toContain("--no-judge");
    expect(check).toContain("--sarif");
    expect(check).toContain("--provider <id>");
    expect(check).toContain("--model <name>");
    expect(extract).toContain("--include-variables");
    expect(check).not.toMatch(/-\w, --(no-judge|sarif|provider|model)/u);
    expect(extract).not.toMatch(/-\w, --include-variables/u);
  });

  it("names the negated judge flag after its positive form", () => {
    expect(parse("check", "--no-judge")["judge"]).toBe(false);
    expect(parse("check")["judge"]).toBe(true);
  });
});
