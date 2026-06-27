/**
 * Chat turn flow (RFC-005).
 *
 * Runs one conversational turn against an agent through the AgentRuntime port,
 * composing the governance pieces — it adds no new authorization. Order matters
 * (coding principles 2 & 4):
 *   1. the subject must own the session (policy-scoped read) or the turn is refused;
 *   2. only policy-authorized memory and the owner's own history reach the prompt;
 *   3. the runtime generates; permissions are never expressed in the prompt;
 *   4. the user message and the reply are appended to the session.
 *
 * Pure domain: the runtime arrives through the port (provider-free). Persisting
 * the updated session and any capability calls the agent requests are the
 * caller's job, through their own governed paths.
 */

import { resolveReadableMemory } from "../memory/resolver.js";
import type { MemoryItem } from "../memory/memory.js";
import type { Policy, PolicyRequest } from "../policy/types.js";
import type { AgentRuntime, RuntimeMessage } from "../runtime/runtime.js";
import { authorizeSessionRead } from "./resolver.js";
import { appendMessage, type Session } from "./session.js";

type Subject = PolicyRequest["subject"];

export interface ChatTurnDeps {
  readonly runtime: AgentRuntime;
}

export interface ChatTurnInput {
  readonly session: Session;
  readonly subject: Subject;
  readonly userText: string;
  /** Candidate memory; the flow filters it to the policy-authorized subset. */
  readonly memory: readonly MemoryItem[];
  readonly policies: readonly Policy[];
  readonly model: string;
  /** Behavioural system prompt only — never an authorization (coding principle 2). */
  readonly systemPrompt?: string;
  readonly now: string;
  readonly correlationId: string;
  readonly userMessageId: string;
  readonly agentMessageId: string;
}

export interface ChatTurnResult {
  readonly session: Session;
  readonly reply: string;
}

function memoryContext(items: readonly MemoryItem[]): string {
  const lines = items.map((i) => `- ${i.summary ?? i.content}`);
  return `Authorized context:\n${lines.join("\n")}`;
}

/**
 * Execute one turn. Throws if the subject does not own the session (owner-private;
 * deny by default) — impersonation/identity resolution happens upstream.
 */
export async function runChatTurn(deps: ChatTurnDeps, input: ChatTurnInput): Promise<ChatTurnResult> {
  const ctx = { sphereId: input.session.sphereId, time: input.now, correlationId: input.correlationId };

  if (authorizeSessionRead(input.subject, input.session, input.policies, ctx).effect !== "allow") {
    throw new Error("Subject is not authorized for this session");
  }

  // Filter before runtime: only policy-authorized memory reaches the prompt.
  const readable = resolveReadableMemory(input.subject, input.memory, input.policies, ctx);

  const messages: RuntimeMessage[] = [];
  if (input.systemPrompt !== undefined && input.systemPrompt.trim() !== "") {
    messages.push({ role: "system", content: input.systemPrompt });
  }
  if (readable.length > 0) {
    messages.push({ role: "system", content: memoryContext(readable) });
  }
  for (const m of input.session.messages) {
    messages.push({ role: m.role === "agent" ? "assistant" : "user", content: m.content });
  }
  messages.push({ role: "user", content: input.userText });

  const response = await deps.runtime.generate({
    model: input.model,
    messages,
    agentId: input.session.agentId,
  });

  let session = appendMessage(input.session, {
    id: input.userMessageId,
    role: "user",
    content: input.userText,
    now: input.now,
    correlationId: input.correlationId,
  });
  session = appendMessage(session, {
    id: input.agentMessageId,
    role: "agent",
    content: response.content,
    now: input.now,
    correlationId: input.correlationId,
  });

  return { session, reply: response.content };
}
