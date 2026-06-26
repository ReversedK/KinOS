/**
 * Thin Node HTTP server wrapping the read API router.
 *
 * The server only adapts transport: it maps an IncomingMessage to an ApiRequest,
 * calls the pure router, and writes JSON with an x-correlation-id header. All
 * decisions live in the router and the core; the server holds no logic.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { handleApiRequest, type ApiDeps, type ApiRequest } from "./router.js";

export function toApiRequest(method: string | undefined, url: string | undefined): ApiRequest {
  const parsed = new URL(url ?? "/", "http://localhost");
  const query: Record<string, string> = {};
  for (const [key, value] of parsed.searchParams) query[key] = value;
  return { method: method ?? "GET", path: parsed.pathname, query };
}

/** Read and JSON-parse a request body; a missing/invalid body resolves to undefined. */
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (raw === "") return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(undefined);
      }
    });
    req.on("error", () => resolve(undefined));
  });
}

export function createApiServer(deps: ApiDeps): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const apiRequest = toApiRequest(req.method, req.url);
      const hasBody = req.method !== undefined && req.method !== "GET" && req.method !== "HEAD";
      const body = hasBody ? await readJsonBody(req) : undefined;
      const response = await handleApiRequest(body !== undefined ? { ...apiRequest, body } : apiRequest, deps);
      res.writeHead(response.status, {
        "content-type": "application/json",
        "x-correlation-id": response.correlationId,
      });
      res.end(JSON.stringify(response.body));
    })();
  });
}
