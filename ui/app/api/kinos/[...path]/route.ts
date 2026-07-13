/**
 * Same-origin proxy to the KinOS API.
 *
 * The browser only ever talks to the Next server (same origin); this handler
 * forwards to the KinOS API server-side. That keeps the API URL server-side,
 * avoids CORS, and preserves the rule that the UI decides no authorization — it
 * only relays the governed request/response (RFC-003, coding principle 1). It
 * adds no auth and strips nothing security-relevant; the API remains the
 * boundary.
 */

import { type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

function apiBase(): string {
  return (process.env.KINOS_API_URL ?? "http://localhost:8787").replace(/\/+$/, "");
}

async function proxy(req: NextRequest, path: string[]): Promise<Response> {
  const search = req.nextUrl.search;
  const target = `${apiBase()}/${path.map(encodeURIComponent).join("/")}${search}`;
  const method = req.method;
  const init: RequestInit = {
    method,
    headers: { "content-type": "application/json" },
    cache: "no-store",
  };
  if (method !== "GET" && method !== "HEAD") {
    init.body = await req.text();
  }
  try {
    const res = await fetch(target, init);
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/json",
        "x-correlation-id": res.headers.get("x-correlation-id") ?? "",
      },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ code: "api_unreachable", message: `KinOS API unreachable: ${(e as Error).message}` }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }
}

type Ctx = { params: { path: string[] } };

export const GET = (req: NextRequest, { params }: Ctx) => proxy(req, params.path);
export const POST = (req: NextRequest, { params }: Ctx) => proxy(req, params.path);
export const PUT = (req: NextRequest, { params }: Ctx) => proxy(req, params.path);
export const DELETE = (req: NextRequest, { params }: Ctx) => proxy(req, params.path);
