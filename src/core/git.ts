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
