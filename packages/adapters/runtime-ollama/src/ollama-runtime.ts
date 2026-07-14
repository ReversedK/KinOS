/**
 * Ollama agent-runtime adapter.
 *
 * Implements @kinos/core's AgentRuntime port against a local Ollama server.
 * Provider-specific (it knows Ollama's HTTP API); it lives outside the domain
 * core and decides no permissions (ADR-001, coding principle 8). It talks to an
 * existing/running Ollama — it does not start one — via OLLAMA_BASE_URL
 * (default http://localhost:11434).
 */

import type {
  AgentRuntime,
  RuntimeRequest,
  RuntimeResponse,
} from "@kinos/core";

const DEFAULT_BASE_URL = "http://localhost:11434";

export interface OllamaRuntimeOptions {
  /** Base URL of the Ollama server; defaults to $OLLAMA_BASE_URL or localhost. */
  readonly baseUrl?: string;
  /** Injectable fetch (tests pass a fake); defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
}

interface OllamaTagsResponse {
  readonly models?: ReadonlyArray<{ readonly name: string }>;
}

interface OllamaChatResponse {
  readonly model?: string;
  readonly message?: { readonly content?: string };
}

export class OllamaRuntime implements AgentRuntime {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OllamaRuntimeOptions = {}) {
    const base = options.baseUrl ?? process.env["OLLAMA_BASE_URL"] ?? DEFAULT_BASE_URL;
    this.baseUrl = base.replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async listModels(): Promise<readonly string[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/tags`);
    if (!res.ok) {
      throw new Error(`Ollama /api/tags failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as OllamaTagsResponse;
    return (body.models ?? []).map((m) => m.name);
  }

  async generate(request: RuntimeRequest): Promise<RuntimeResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
      }),
    });
    if (!res.ok) {
      // Surface Ollama's own reason (e.g. `model '…' not found`) — a bare status
      // hides the most common cause: the Sphere's configured model isn't pulled.
      const detail = (await res.text().catch(() => "")).trim();
      throw new Error(
        `Ollama /api/chat failed: ${res.status} ${res.statusText}${detail !== "" ? ` — ${detail}` : ""}`,
      );
    }
    const body = (await res.json()) as OllamaChatResponse;
    return {
      model: body.model ?? request.model,
      content: body.message?.content ?? "",
    };
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
