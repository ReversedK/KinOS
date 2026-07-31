/**
 * MinIO/S3 `ObjectStore` adapter (RFC-048).
 *
 * The only file that touches the MinIO client — it implements the `ObjectStore` port
 * so the provider (and the core) never see an S3 SDK. Constructed at wiring time from
 * deployment env (`MINIO_ENDPOINT` etc.); per-Sphere isolation is by bucket. A real
 * deployment sets these; dev/tests use `InMemoryObjectStore` instead.
 */

import { Client } from "minio";

import type { ObjectStore } from "./object-documents.js";

export interface MinioConfig {
  readonly endPoint: string;
  readonly port?: number;
  readonly useSSL?: boolean;
  readonly accessKey: string;
  readonly secretKey: string;
}

/** Build a MinIO config from process env, or `undefined` when MinIO is not configured. */
export function minioConfigFromEnv(env: NodeJS.ProcessEnv): MinioConfig | undefined {
  const endPoint = env["MINIO_ENDPOINT"];
  const accessKey = env["MINIO_ACCESS_KEY"];
  const secretKey = env["MINIO_SECRET_KEY"];
  if (endPoint === undefined || accessKey === undefined || secretKey === undefined) return undefined;
  const port = env["MINIO_PORT"] !== undefined ? Number(env["MINIO_PORT"]) : undefined;
  return {
    endPoint,
    ...(port !== undefined && !Number.isNaN(port) ? { port } : {}),
    useSSL: env["MINIO_USE_SSL"] === "true",
    accessKey,
    secretKey,
  };
}

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export class MinioObjectStore implements ObjectStore {
  private readonly client: Client;

  constructor(config: MinioConfig) {
    this.client = new Client({
      endPoint: config.endPoint,
      ...(config.port !== undefined ? { port: config.port } : {}),
      useSSL: config.useSSL ?? false,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
    });
  }

  async ensureBucket(bucket: string): Promise<void> {
    if (!(await this.client.bucketExists(bucket).catch(() => false))) {
      await this.client.makeBucket(bucket);
    }
  }

  async list(bucket: string): Promise<readonly string[]> {
    const keys: string[] = [];
    const stream = this.client.listObjectsV2(bucket, "", true);
    for await (const obj of stream as AsyncIterable<{ name?: string }>) {
      if (obj.name !== undefined) keys.push(obj.name);
    }
    return keys;
  }

  async get(bucket: string, key: string): Promise<string | undefined> {
    try {
      const stream = await this.client.getObject(bucket, key);
      return await streamToString(stream);
    } catch (e) {
      // Deny-by-default on a missing object rather than throwing (NoSuchKey/NotFound).
      const code = (e as { code?: string }).code;
      if (code === "NoSuchKey" || code === "NotFound") return undefined;
      throw e;
    }
  }

  async put(bucket: string, key: string, content: string): Promise<void> {
    const body = Buffer.from(content, "utf8");
    await this.client.putObject(bucket, key, body, body.length, { "Content-Type": "text/plain; charset=utf-8" });
  }
}
