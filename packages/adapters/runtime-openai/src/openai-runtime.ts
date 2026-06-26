/**
 * OpenAI agent-runtime adapter (cloud).
 *
 * Implements @kinos/core's AgentRuntime port against the OpenAI HTTP API. It is
 * provider-specific and lives outside the domain core; it decides no permissions
 * (ADR-001, coding principle 8). It is a *cloud* runtime: every call is an
 * external transfer that the caller must have authorized and must audit
 * (RFC-004, invariant 14).
 *
 * Credentials are passed in already resolved (the secret store resolves a
 * RuntimeProfile.secretRef → key upstream); the adapter never sees a reference
 * and never logs the key. $OPENAI_API_KEY is a dev fallback only.
 */

import type { AgentRuntime, RuntimeRequest, RuntimeResponse } from "@kinos/core";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export interface OpenAiRuntimeOptions {
  /** Resolved API key (from the secret store); falls back to $OPENAI_API_KEY in dev. */
  readonly apiKey?: string;
  /** Base URL; defaults to $OPENAI_BASE_URL or the OpenAI API. */
  readonly baseUrl?: string;
  /** Injectable fetch (tests pass a fake); defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
}

interface OpenAiModelsResponse {
  readonly data?: ReadonlyArray<{ readonly id: string }>;
}

interface OpenAiChatResponse {
  readonly model?: string;
  readonly choices?: ReadonlyArray<{ readonly message?: { readonly content?: string } }>;
}

export class OpenAiRuntime implements AgentRuntime {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiRuntimeOptions = {}) {
    const apiKey = options.apiKey ?? process.env["OPENAI_API_KEY"] ?? "";
    if (apiKey.trim() === "") {
      throw new Error("OpenAiRuntime requires an API key (resolve the secret reference upstream)");
    }
    this.apiKey = apiKey;
    const base = options.baseUrl ?? process.env["OPENAI_BASE_URL"] ?? DEFAULT_BASE_URL;
    this.baseUrl = base.replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    return { authorization: `Bearer ${this.apiKey}`, ...extra };
  }

  async listModels(): Promise<readonly string[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/models`, { headers: this.authHeaders() });
    if (!res.ok) {
      throw new Error(`OpenAI /models failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as OpenAiModelsResponse;
    return (body.data ?? []).map((m) => m.id);
  }

  async generate(request: RuntimeRequest): Promise<RuntimeResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI /chat/completions failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as OpenAiChatResponse;
    return {
      model: body.model ?? request.model,
      content: body.choices?.[0]?.message?.content ?? "",
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
