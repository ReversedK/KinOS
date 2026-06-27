import { afterEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FsEncryptedBlobStore } from "./fs-encrypted-blob-store.js";

let dir: string | undefined;
afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("FsEncryptedBlobStore (RFC-007/ADR-007)", () => {
  it("captures a directory and restores it byte-for-byte; the blob is encrypted (opaque)", async () => {
    dir = mkdtempSync(join(tmpdir(), "kinos-blob-"));
    const key = randomBytes(32);
    const store = new FsEncryptedBlobStore({ dir: join(dir, "blobs"), key });

    const src = join(dir, "profile");
    mkdirSync(join(src, "sessions"), { recursive: true });
    writeFileSync(join(src, "config.yaml"), "model: x\n");
    writeFileSync(join(src, "sessions", "a.bin"), Buffer.from([0, 1, 2, 250, 255]));

    const ref = await store.capture("snap_1", src);
    expect(ref).toBe("blob://snap_1");

    // The on-disk blob must NOT contain the plaintext (it's encrypted).
    const raw = readFileSync(join(dir, "blobs", "snap_1.blob"));
    expect(raw.includes(Buffer.from("model: x"))).toBe(false);

    const dest = join(dir, "restored");
    await store.restore(ref, dest);
    expect(readFileSync(join(dest, "config.yaml"), "utf8")).toBe("model: x\n");
    expect([...readFileSync(join(dest, "sessions", "a.bin"))]).toEqual([0, 1, 2, 250, 255]);
  });

  it("restore overwrites pre-existing state in the destination", async () => {
    dir = mkdtempSync(join(tmpdir(), "kinos-blob-"));
    const store = new FsEncryptedBlobStore({ dir: join(dir, "blobs"), key: randomBytes(32) });
    const src = join(dir, "src");
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, "keep.txt"), "new");
    const ref = await store.capture("s", src);

    const dest = join(dir, "dest");
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "stale.txt"), "old"); // must be gone after restore
    await store.restore(ref, dest);

    expect(readFileSync(join(dest, "keep.txt"), "utf8")).toBe("new");
    expect(() => readFileSync(join(dest, "stale.txt"))).toThrow();
  });

  it("a wrong key cannot decrypt the blob (auth tag fails)", async () => {
    dir = mkdtempSync(join(tmpdir(), "kinos-blob-"));
    const blobDir = join(dir, "blobs");
    const src = join(dir, "src");
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, "f"), "secret");
    const ref = await new FsEncryptedBlobStore({ dir: blobDir, key: randomBytes(32) }).capture("s", src);

    const wrong = new FsEncryptedBlobStore({ dir: blobDir, key: randomBytes(32) });
    await expect(wrong.restore(ref, join(dir, "out"))).rejects.toThrow();
  });

  it("rejects a non-32-byte key", () => {
    expect(() => new FsEncryptedBlobStore({ dir: "/x", key: randomBytes(16) })).toThrow(/32-byte/);
  });
});
