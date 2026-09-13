import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";

import { extractSymbols } from "../src/adapters/typescript/extract/index.js";
import { loadProject } from "../src/adapters/typescript/loadProject.js";
import {
  loadWorkspace,
  resolveWorkspace,
} from "../src/adapters/typescript/loadWorkspace.js";

interface BenchmarkResult {
  readonly mode: string;
  readonly wallMs: number;
  readonly peakRssMb: number;
  readonly projects: number;
  readonly files: number;
  readonly lines: number;
  readonly symbols: number;
}

const printResult = (result: BenchmarkResult): void => {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
};

const sum = (values: readonly number[]): number => {
  return values.reduce((total, value) => total + value, 0);
};

const countLines = async (filePaths: readonly string[]): Promise<number> => {
  const counts = await Promise.all(
    filePaths.map(async (filePath) => {
      const text = await readFile(filePath, "utf8");
      return text === "" ? 0 : text.split("\n").length;
    }),
  );
  return sum(counts);
};

const [mode, target, pattern, concurrencyText] = process.argv.slice(2);

if (mode === "single" && target !== undefined) {
  const startedAt = performance.now();
  const project = await loadProject({ tsconfigPath: resolve(target) });
  const symbols = extractSymbols(project);
  const wallMs = performance.now() - startedAt;
  const lines = await countLines(
    project.sourceFiles.map((sourceFile) => sourceFile.getFilePath()),
  );
  printResult({
    mode,
    wallMs,
    peakRssMb: process.resourceUsage().maxRSS / 1024,
    projects: 1,
    files: project.sourceFiles.length,
    lines,
    symbols: symbols.length,
  });
} else if (
  mode === "workspace" &&
  target !== undefined &&
  pattern !== undefined
) {
  const root = resolve(target);
  const concurrency = Number(concurrencyText ?? "1");
  const workspace = await resolveWorkspace({
    root,
    projects: [pattern],
    projectConcurrency: concurrency,
  });
  const startedAt = performance.now();
  const projectResults = await loadWorkspace(
    { root, projects: [pattern], projectConcurrency: concurrency },
    (project) => {
      const symbols = extractSymbols(project);
      return {
        files: project.sourceFiles.length,
        filePaths: project.sourceFiles.map((sourceFile) =>
          sourceFile.getFilePath(),
        ),
        symbols: symbols.length,
      };
    },
  );
  const wallMs = performance.now() - startedAt;
  const lines = await countLines(
    projectResults.flatMap((result) => result.filePaths),
  );
  printResult({
    mode,
    wallMs,
    peakRssMb: process.resourceUsage().maxRSS / 1024,
    projects: workspace.projects.length,
    files: sum(projectResults.map((result) => result.files)),
    lines,
    symbols: sum(projectResults.map((result) => result.symbols)),
  });
} else {
  process.stderr.write(
    "Usage: benchmark-extraction.ts single <tsconfig> | workspace <root> <project-glob> [concurrency]\n",
  );
  process.exitCode = 2;
}
