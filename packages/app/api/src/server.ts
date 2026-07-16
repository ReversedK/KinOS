/**
 * Thin Node HTTP server wrapping the read API router.
 *
 * The server only adapts transport: it maps an IncomingMessage to an ApiRequest,
 * calls the pure router, and writes JSON with an x-correlation-id header. All
 * decisions live in the router and the core; the server holds no logic.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { handleApiRequest, type ApiDeps, type ApiRequest } from "./router.js";
import { handleSphereMcpRpc, type JsonRpcRequest, type SphereMcpServerDeps } from "./sphere-mcp-server.js";

/** Bearer token from an Authorization header, or "" when absent (fail closed). */
function bearer(req: IncomingMessage): string {
  const h = req.headers["authorization"];
  const value = Array.isArray(h) ? h[0] : h;
  if (value === undefined) return "";
  const m = /^Bearer\s+(.+)$/i.exec(value.trim());
  return m?.[1]?.trim() ?? "";
}

/** Match POST /spheres/:id/mcp — the per-Sphere MCP gateway (ADR-007). */
function matchMcp(method: string | undefined, path: string): string | undefined {
  if (method !== "POST") return undefined;
  const segs = path.split("/").filter((s) => s.length > 0);
  if (segs.length === 3 && segs[0] === "spheres" && segs[2] === "mcp") return segs[1];
  return undefined;
}

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

export function createApiServer(deps: ApiDeps, mcp?: SphereMcpServerDeps): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      try {
      const apiRequest = toApiRequest(req.method, req.url);

      // OAuth broker handler (RFC-018): Better Auth owns the provider callback at
      // its own basePath (e.g. /api/auth/*). Mount it verbatim when a broker with a
      // node handler is wired; it manages its own request/response.
      const broker = deps.authBroker;
      if (broker?.nodeHandler !== undefined && broker.basePath !== undefined && apiRequest.path.startsWith(broker.basePath)) {
        broker.nodeHandler(req, res);
        return;
      }

      // Sphere MCP gateway (RFC-007, ADR-007): bearer-authenticated JSON-RPC,
      // served only when MCP deps are wired. The token is the boundary.
      const sphereId = matchMcp(req.method, apiRequest.path);
      if (sphereId !== undefined && mcp !== undefined) {
        const rpc = ((await readJsonBody(req)) ?? {}) as JsonRpcRequest;
        const rpcRes = await handleSphereMcpRpc({ sphereId, token: bearer(req), request: rpc }, mcp);
        // JSON-RPC notifications (no id) get no response body, per MCP/JSON-RPC.
        if (rpc.id === undefined && rpc.method?.startsWith("notifications/")) {
          res.writeHead(202).end();
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(rpcRes));
        return;
      }

      const hasBody = req.method !== undefined && req.method !== "GET" && req.method !== "HEAD";
      const body = hasBody ? await readJsonBody(req) : undefined;
      // Request headers are needed to read the broker session at /oauth/connected.
      const headers = req.headers as Record<string, string | undefined>;
      const response = await handleApiRequest({ ...apiRequest, headers, ...(body !== undefined ? { body } : {}) }, deps);
      res.writeHead(response.status, {
        "content-type": "application/json",
        "x-correlation-id": response.correlationId,
      });
      res.end(JSON.stringify(response.body));
      } catch (e) {
        // Safety net: an unexpected error must never crash the process or leak
        // internals. Surface a correlated 500; the router converts expected
        // execution failures to 4xx before they reach here.
        const correlationId = deps.newCorrelationId();
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json", "x-correlation-id": correlationId });
          res.end(JSON.stringify({ code: "internal_error", message: "Internal error" }));
        } else {
          res.end();
        }
      }
    })();
  });
}
