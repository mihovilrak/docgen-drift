import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const subjectCache = new Map<string, Promise<string | undefined>>();

export interface GitSubjectRequest {
  readonly root: string;
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly timeoutMs: number;
}

/**
 * Resolve the git commit subject for a file's line range, memoizing the lookup (including in-flight requests) by root, path, line range, and timeout.
 * @param request Identifies the repository root, file path, line range, and timeout to look up the owning commit's subject for.
 * @returns The subject line of the commit that last touched the range, or undefined if none could be determined.
 */
export const findGitSubject = async (
  request: GitSubjectRequest,
): Promise<string | undefined> => {
  const key = [
    request.root,
    request.filePath,
    request.startLine,
    request.endLine,
    request.timeoutMs,
  ].join("\0");
  const cached = subjectCache.get(key);
  if (cached !== undefined) return cached;

  const pending = lookupGitSubject(request);
  subjectCache.set(key, pending);
  return pending;
};

export const clearGitSubjectCache = (): void => {
  subjectCache.clear();
};

/**
 * Check for tracked or untracked changes using porcelain status with a five-second timeout.
 * @param root Filesystem path to the Git repository to inspect.
 */
export const isWorkingTreeDirty = async (root: string): Promise<boolean> => {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["status", "--porcelain", "--untracked-files=normal"],
      {
        cwd: root,
        timeout: 5000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
    );
    return stdout.trim() !== "";
  } catch {
    throw new Error(`Cannot inspect Git working tree at ${root}`);
  }
};

const lookupGitSubject = async (
  request: GitSubjectRequest,
): Promise<string | undefined> => {
  try {
    const { stdout } = await execFileAsync(
      "git",
      [
        "log",
        "-L",
        `${String(request.startLine)},${String(request.endLine)}:${request.filePath}`,
        "--format=%s",
        "-n",
        "1",
      ],
      {
        cwd: request.root,
        timeout: request.timeoutMs,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
    );
    return stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line !== "");
  } catch {
    return undefined;
  }
};
