import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { clearGitSubjectCache, findGitSubject } from "../src/core/git.js";

const execFileAsync = promisify(execFile);

describe("git subject context", () => {
  it("looks up a line-range subject, caches it, and falls back cleanly", async () => {
    const root = await mkdtemp(join(tmpdir(), "docgen-git-"));
    await execFileAsync("git", ["init", "--quiet"], { cwd: root });
    await execFileAsync("git", ["config", "user.name", "Docgen Test"], {
      cwd: root,
    });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: root,
    });
    await writeFile(
      join(root, "example.ts"),
      "export const value = 1;\n",
      "utf8",
    );
    await execFileAsync("git", ["add", "example.ts"], { cwd: root });
    await execFileAsync(
      "git",
      ["commit", "--quiet", "-m", "Add example value"],
      {
        cwd: root,
      },
    );

    clearGitSubjectCache();
    const request = {
      root,
      filePath: "example.ts",
      startLine: 1,
      endLine: 1,
      timeoutMs: 2_000,
    };
    await expect(findGitSubject(request)).resolves.toBe("Add example value");
    await expect(findGitSubject(request)).resolves.toBe("Add example value");
    await expect(
      findGitSubject({ ...request, filePath: "missing.ts" }),
    ).resolves.toBeUndefined();
  });
});
