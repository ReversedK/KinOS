/**
 * Object-store documents provider (RFC-048).
 *
 * A `document.*` integration provider backed by an S3-style object store the Sphere
 * owns (MinIO in a real deployment). Unlike the read-only `local` (shared notes) and
 * `google_drive` sources, this one is WRITABLE: it implements `document.upload` as
 * well as `document.search` / `document.summarize`.
 *
 * The provider depends only on a small `ObjectStore` PORT — `list` / `get` / `put`
 * over a per-Sphere bucket — so no S3/MinIO SDK leaks into the core (coding-principles).
 * The real MinIO client lives in a separate `MinioObjectStore` adapter; an
 * `InMemoryObjectStore` here backs dev and tests. Per-Sphere isolation is structural:
 * each Sphere gets its own bucket (`bucketForSphere`).
 */

import type { IntegrationProviderAdapter } from "./integration-executor.js";
import { extractiveSummary } from "./documents.js";

/**
 * The object-store port. Text-only in the MVP (objects are UTF-8 documents); binary
 * extraction (PDF, docx) is a later adapter concern per RFC-048. Every method is
 * scoped to a bucket so a Sphere can never reach another's objects.
 */
export interface ObjectStore {
  /** Create the bucket if it does not exist (idempotent). */
  ensureBucket(bucket: string): Promise<void>;
  /** List the object keys in a bucket. */
  list(bucket: string): Promise<readonly string[]>;
  /** Fetch an object's text, or `undefined` if the key does not exist. */
  get(bucket: string, key: string): Promise<string | undefined>;
  /** Put (create or overwrite) an object's text. */
  put(bucket: string, key: string, content: string): Promise<void>;
}

/**
 * The bucket name for a Sphere. S3 bucket names must be lower-case, 3–63 chars,
 * `[a-z0-9-]`. We derive a stable, valid name from the Sphere id.
 */
export function bucketForSphere(sphereId: string): string {
  const slug = sphereId.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
  return `kinos-docs-${slug}`.slice(0, 63);
}

/** An in-memory reference `ObjectStore` for dev and tests — no external service. */
export class InMemoryObjectStore implements ObjectStore {
  private readonly buckets = new Map<string, Map<string, string>>();

  private bucket(name: string): Map<string, string> {
    let b = this.buckets.get(name);
    if (b === undefined) {
      b = new Map();
      this.buckets.set(name, b);
    }
    return b;
  }

  async ensureBucket(bucket: string): Promise<void> {
    this.bucket(bucket);
  }
  async list(bucket: string): Promise<readonly string[]> {
    return [...this.bucket(bucket).keys()];
  }
  async get(bucket: string, key: string): Promise<string | undefined> {
    return this.bucket(bucket).get(key);
  }
  async put(bucket: string, key: string, content: string): Promise<void> {
    this.bucket(bucket).set(key, content);
  }
}

/**
 * The object-store documents provider. Reads by listing the Sphere's bucket and
 * matching the query against each object's key + text (MVP: no separate index — it
 * is derived from the store on each read, per RFC-048). Writes via `document.upload`.
 */
export function objectDocumentsProvider(store: ObjectStore): IntegrationProviderAdapter {
  return async (capability, input, ctx) => {
    const bucket = bucketForSphere(ctx.sphereId);
    const args = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;

    if (capability === "document.search") {
      await store.ensureBucket(bucket);
      const query = typeof args["query"] === "string" ? (args["query"] as string).trim().toLowerCase() : "";
      const keys = await store.list(bucket);
      const documents: Array<{ id: string; content: string }> = [];
      for (const key of keys) {
        const content = (await store.get(bucket, key)) ?? "";
        if (query === "" || key.toLowerCase().includes(query) || content.toLowerCase().includes(query)) {
          documents.push({ id: key, content });
        }
      }
      return { documents };
    }

    if (capability === "document.summarize") {
      const id = args["documentId"];
      if (typeof id !== "string") throw new Error("document.summarize requires a documentId");
      const content = await store.get(bucket, id);
      if (content === undefined) {
        return { id, summary: `“${id}” — not found in this Sphere's documents.` };
      }
      return { id, summary: extractiveSummary(content) };
    }

    if (capability === "document.upload") {
      const name = args["name"];
      const content = args["content"];
      if (typeof name !== "string" || name.trim() === "") throw new Error("document.upload requires a name");
      if (typeof content !== "string") throw new Error("document.upload requires string content");
      await store.ensureBucket(bucket);
      const key = name.trim();
      await store.put(bucket, key, content);
      return { uploaded: true, id: key };
    }

    throw new Error(`The object-store documents provider does not implement '${capability}'`);
  };
}
