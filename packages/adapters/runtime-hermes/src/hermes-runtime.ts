/**
 * Hermes agent-runtime adapter (RFC-007).
 *
 * Implements @kinos/core's AgentRuntime port against a running Hermes deployment
 * (one container, many agents via profiles). Provider-specific and outside the
 * domain core (ADR-001, coding principle 8): it knows Hermes' wire shape and
 * decides no permissions — by the time a request reaches it, only authorized
 * context has been assembled upstream and capabilities are reached through the
 * Sphere MCP, not here.
 *
 * Routing is **per profile**: RFC-007 maps one Hermes profile to one principal,
 * so a turn is sent to the calling agent's profile (RuntimeRequest.agentId). A
 * request without an agentId is refused — Hermes has no ambient profile.
 *
 * Wire contract (the integration seam — confirm against the deployed Hermes;
 * every path is overridable):
 *   - GET  {baseUrl}/models                     -> { models: [{ name }] } | string[]
 *   - POST {baseUrl}/agents/{profile}/messages  -> { reply | message | content }
 * It talks to an existing Hermes via HERMES_BASE_URL (default localhost:9001);
 * it does not start one.
 */

import type { AgentRuntime, RuntimeRequest, RuntimeResponse } from "@kinos/core";

const DEFAULT_BASE_URL = "http://localhost:9001";

export interface HermesRuntimeOptions {
  /** Base URL of the Hermes gateway; defaults to $HERMES_BASE_URL or localhost. */
  readonly baseUrl?: string;
  /** Injectable fetch (tests pass a fake); defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Path for listing models; defaults to "/models". */
  readonly modelsPath?: string;
  /** Per-profile message endpoint; "{profile}" is substituted. */
  readonly messagePath?: string;
}

interface HermesModelsResponse {
  readonly models?: ReadonlyArray<{ readonly name: string } | string>;
}

interface HermesMessageResponse {
  readonly model?: string;
  readonly reply?: string;
  readonly message?: string | { readonly content?: string };
  readonly content?: string;
}

export class HermesRuntime implements AgentRuntime {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly modelsPath: string;
  private readonly messagePath: string;

  constructor(options: HermesRuntimeOptions = {}) {
    const base = options.baseUrl ?? process.env["HERMES_BASE_URL"] ?? DEFAULT_BASE_URL;
    this.baseUrl = base.replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.modelsPath = options.modelsPath ?? "/models";
    this.messagePath = options.messagePath ?? "/agents/{profile}/messages";
  }

  async listModels(): Promise<readonly string[]> {
    const res = await this.fetchImpl(`${this.baseUrl}${this.modelsPath}`);
    if (!res.ok) {
      throw new Error(`Hermes ${this.modelsPath} failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as HermesModelsResponse | readonly string[];
    const models: ReadonlyArray<{ readonly name: string } | string> = Array.isArray(body)
      ? (body as readonly string[])
      : ((body as HermesModelsResponse).models ?? []);
    return models.map((m) => (typeof m === "string" ? m : m.name));
  }

  async generate(request: RuntimeRequest): Promise<RuntimeResponse> {
    if (request.agentId === undefined || request.agentId.trim() === "") {
      // Hermes routes per profile; there is no ambient agent (deny by default).
      throw new Error("Hermes runtime requires an agentId (one profile per principal)");
    }
    const path = this.messagePath.replace("{profile}", encodeURIComponent(request.agentId));
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
      }),
    });
    if (!res.ok) {
      throw new Error(`Hermes message send failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as HermesMessageResponse;
    return { model: body.model ?? request.model, content: extractReply(body) };
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.listModels();
      return true;
    } catch {
      return false;
    }
  }
}

function extractReply(body: HermesMessageResponse): string {
  if (typeof body.reply === "string") return body.reply;
  if (typeof body.content === "string") return body.content;
  if (typeof body.message === "string") return body.message;
  if (body.message !== undefined && typeof body.message === "object") {
    return body.message.content ?? "";
  }
  return "";
}
