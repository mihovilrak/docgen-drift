import type { CAC, Command } from "cac";

import { ConfigError } from "../config/load.js";

/** A cac option declaration: raw name (both forms) and its help text. */
export type OptionSpec = readonly [name: string, description: string];

export const CONFIG: OptionSpec = [
  "-c, --config <path>",
  "Path to .docgenrc.json",
];
export const JSON_OUTPUT: OptionSpec = [
  "-j, --json",
  "Print machine-readable JSON",
];
export const PROJECT: OptionSpec = [
  "-P, --project <path-or-glob>",
  "Restrict to matching tsconfig projects",
];
export const PATH: OptionSpec = [
  "-p, --path <path>",
  "Restrict backfill to this path",
];
export const SINCE: OptionSpec = [
  "-s, --since <ref>",
  "Restrict to symbols touched since a Git ref",
];
export const FIX: OptionSpec = [
  "-f, --fix",
  "Regenerate drifted documentation",
];
export const MISSING: OptionSpec = [
  "-m, --missing",
  "Generate documentation for missing symbols",
];

/**
 * Safety-sensitive or rarely typed flags stay long-only: an abbreviation of
 * `--no-judge`, `--sarif` or `--include-variables` would not be self-evident.
 */
export const SARIF: OptionSpec = ["--sarif", "Print SARIF 2.1.0"];
export const INCLUDE_VARIABLES: OptionSpec = [
  "--include-variables",
  "Include exported non-function variables",
];
export const NO_JUDGE: OptionSpec = [
  "--no-judge",
  "Apply generated documentation without judging it",
];

export const GENERATION: readonly OptionSpec[] = [
  ["-n, --dry-run", "Print the source diff without writing"],
  ["-a, --allow-dirty", "Allow source writes with uncommitted changes"],
  NO_JUDGE,
  ["--provider <id>", "Override the generation provider for this run"],
  ["--model <name>", "Override the generation model for this run"],
];

export const withOptions = (
  command: Command,
  ...specs: readonly OptionSpec[]
): Command =>
  specs.reduce(
    (current, [name, description]) => current.option(name, description),
    command,
  );

/**
 * cac lets two options on the same command share a short flag and silently
 * keeps the last one. Refuse instead, so an alias can never shadow another
 * option.
 */
export const assertNoShortFlagCollisions = (cli: CAC): void => {
  for (const command of cli.commands) {
    const seen = new Map<string, string>();
    for (const option of [...cli.globalCommand.options, ...command.options]) {
      for (const short of option.names.filter((name) => name.length === 1)) {
        const previous = seen.get(short);
        if (previous !== undefined && previous !== option.rawName) {
          throw new ConfigError(
            `Option -${short} is declared twice on "${command.name === "" ? cli.name : command.name}": ${previous} and ${option.rawName}`,
          );
        }
        seen.set(short, option.rawName);
      }
    }
  }
};
