import { ConfigError } from "../config/load.js";
import { SinceError } from "./since.js";

export type ExitCode = 0 | 1 | 2 | 3;

export const checkExitCode = (issueCount: number): ExitCode =>
  issueCount === 0 ? 0 : 1;

/**
 * Map recognized CLI usage errors to exit code 2 and all other errors to code 3.
 * @param error The unknown error value to classify.
 * @returns Returns 2 for ConfigError, SinceError, or CACError instances; otherwise returns 3.
 */
export const errorExitCode = (error: unknown): ExitCode =>
  error instanceof ConfigError ||
  error instanceof SinceError ||
  (error instanceof Error && error.name === "CACError")
    ? 2
    : 3;
