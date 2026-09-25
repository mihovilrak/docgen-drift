import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  LOCK_SCHEMA_VERSION,
  emptyLock,
  readLock,
  writeLock,
} from "../src/core/lock.js";

describe("lockfiles", () => {
  it("treats an absent lockfile as empty and round-trips the current schema", async () => {
    const root = await mkdtemp(join(tmpdir(), "docgen-lock-"));
    const path = join(root, ".docgen", "lock.json");

    await expect(readLock(path)).resolves.toEqual({
      ok: true,
      value: emptyLock(),
    });
    const lock = {
      schemaVersion: LOCK_SCHEMA_VERSION,
      symbols: {
        "src/api.ts#read": {
          symbolHash: "symbol",
          docHash: "doc",
          filePath: "src/api.ts",
          startLine: 4,
        },
      },
    } as const;
    await expect(writeLock(path, lock)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(readLock(path)).resolves.toEqual({ ok: true, value: lock });
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      schemaVersion: LOCK_SCHEMA_VERSION,
    });
  });

  it("requires explicit rebaselining for previous hashes and rejects future schemas", async () => {
    const legacy = {
      symbols: {
        "src/api.ts#read": { symbol_hash: "symbol", doc_hash: "doc" },
      },
    };
    const migrated = await importLock(legacy);
    expect(migrated).toMatchObject({
      ok: false,
      error: {
        code: "unsupported-version",
      },
    });
    if (!migrated.ok)
      expect(migrated.error.message).toContain("docgen baseline");

    await expect(
      importLock({ schemaVersion: LOCK_SCHEMA_VERSION + 1, symbols: {} }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "unsupported-version" },
    });
  });
});

const importLock = async (value: unknown) => {
  const root = await mkdtemp(join(tmpdir(), "docgen-lock-import-"));
  const path = join(root, "lock.json");
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(path, JSON.stringify(value), "utf8"),
  );
  return readLock(path);
};
