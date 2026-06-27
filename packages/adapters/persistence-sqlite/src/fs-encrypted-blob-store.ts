/**
 * Filesystem encrypted blob store (RFC-007, ADR-007).
 *
 * Implements @kinos/core's RuntimeStateBlobStore: captures an agent's runtime
 * profile directory as a single **opaque, encrypted** blob (AES-256-GCM) and
 * restores it. KinOS treats the content as opaque — it serializes the directory,
 * encrypts it, and stores it by reference; it never inspects it (invariant 16).
 *
 * Dependency-free capture: the directory is walked into `{ path -> base64 }`,
 * JSON-encoded, then encrypted (no tar/child_process). The blob layout is
 * `iv(12) || authTag(16) || ciphertext`. The key (32 bytes) comes from the
 * secret store upstream; the adapter never logs it.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

import type { RuntimeStateBlobStore } from "@kinos/core";

const IV_LEN = 12;

async function walk(dir: string, root: string, acc: Record<string, string>): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // missing source dir → empty snapshot (capture is non-fatal)
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, root, acc);
    } else if (e.isFile()) {
      const rel = relative(root, full).split(sep).join("/");
      acc[rel] = (await readFile(full)).toString("base64");
    }
  }
}

export class FsEncryptedBlobStore implements RuntimeStateBlobStore {
  private readonly dir: string;
  private readonly key: Buffer;

  constructor(options: { readonly dir: string; readonly key: Buffer }) {
    if (options.key.length !== 32) {
      throw new Error("FsEncryptedBlobStore requires a 32-byte key (AES-256)");
    }
    this.dir = options.dir;
    this.key = options.key;
  }

  private blobPath(id: string): string {
    return join(this.dir, `${id}.blob`);
  }

  async capture(id: string, sourceDir: string): Promise<string> {
    const files: Record<string, string> = {};
    await walk(sourceDir, sourceDir, files);
    const plaintext = Buffer.from(JSON.stringify({ files }), "utf8");
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const blob = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.blobPath(id), blob);
    return `blob://${id}`;
  }

  async restore(ref: string, destDir: string): Promise<void> {
    const id = ref.replace(/^blob:\/\//, "");
    const blob = await readFile(this.blobPath(id));
    const iv = blob.subarray(0, IV_LEN);
    const authTag = blob.subarray(IV_LEN, IV_LEN + 16);
    const ciphertext = blob.subarray(IV_LEN + 16);
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const { files } = JSON.parse(plaintext.toString("utf8")) as { files: Record<string, string> };

    // Overwrite current runtime state with the snapshot's.
    await rm(destDir, { recursive: true, force: true });
    for (const [rel, b64] of Object.entries(files)) {
      const target = join(destDir, rel);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(b64, "base64"));
    }
  }
}
