import { createRequire } from "node:module";

const packageJson = createRequire(import.meta.url)("../package.json") as {
  readonly version: string;
};

export const VERSION = packageJson.version;
