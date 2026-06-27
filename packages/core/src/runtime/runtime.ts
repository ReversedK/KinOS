/**
 * Agent runtime port (ADR-001).
 *
 * The runtime executes; it never decides permissions, memory visibility or
 * policy. By the time a request reaches it, only authorized context and an
 * authorized capability list have been assembled upstream. This is a pure
 * interface in the domain core — concrete runtimes (Ollama, Hermes, …) are
 * adapters outside the core that implement it (coding principle 1, 8).
 */

export type RuntimeRole = "system" | "user" | "assistant";

export interface RuntimeMessage {
  readonly role: RuntimeRole;
  /** Already-authorized content; the runtime is not a privacy boundary. */
  readonly content: string;
}

export interface RuntimeRequest {
  /** Model tag/preference; the runtime owns no memory and is replaceable. */
  readonly model: string;
  readonly messages: readonly RuntimeMessage[];
  /**
   * The calling agent, used by runtimes that route per-agent (RFC-007: one
   * Hermes profile per principal). Provider-free runtimes (Ollama, OpenAI)
   * ignore it; it is never an authorization (authorization is decided upstream).
   */
  readonly agentId?: string;
}

export interface RuntimeResponse {
  readonly model: string;
  readonly content: string;
}

export interface AgentRuntime {
  /** List the models the runtime currently has available. */
  listModels(): Promise<readonly string[]>;
  /** Generate a completion from already-authorized messages. */
  generate(request: RuntimeRequest): Promise<RuntimeResponse>;
  /** Whether the runtime is reachable right now (used for fail-closed checks). */
  isAvailable(): Promise<boolean>;
}
