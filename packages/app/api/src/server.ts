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

export function createApiServer(deps: ApiDeps): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const response = await handleApiRequest(toApiRequest(req.method, req.url), deps);
      res.writeHead(response.status, {
        "content-type": "application/json",
        "x-correlation-id": response.correlationId,
      });
      res.end(JSON.stringify(response.body));
    })();
  });
}
