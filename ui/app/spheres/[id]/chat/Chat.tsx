"use client";

import { useCallback, useEffect, useState } from "react";

import {
  createSession,
  getSession,
  listSessions,
  postChatTurn,
  type ActingSubject,
  type ChatMessage,
  type SessionSummary,
} from "../../../../lib/api";

function ageProfileForRole(role: string): string {
  if (role === "child") return "child";
  if (role === "teenager") return "teen";
  return "adult";
}

export interface ChatMember {
  readonly id: string;
  readonly role: string;
}
export interface ChatAgent {
  readonly id: string;
  readonly name: string;
}

/**
 * Chat with an agent (RFC-005). Owner-private: the member acting (dev selector,
 * anticipating auth/RFC-006) is the session owner; the UI only triggers governed
 * endpoints and renders the transcript it is allowed to read.
 */
export function Chat({
  baseUrl,
  sphereId,
  members,
  agents,
}: {
  baseUrl: string;
  sphereId: string;
  members: readonly ChatMember[];
  agents: readonly ChatAgent[];
}) {
  const [ownerId, setOwnerId] = useState(members[0]?.id ?? "");
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const subject = (): ActingSubject => {
    const m = members.find((x) => x.id === ownerId);
    return { memberId: ownerId, role: m?.role ?? "guest", ageProfile: ageProfileForRole(m?.role ?? "guest") };
  };

  const refreshSessions = useCallback(async () => {
    if (ownerId === "") return;
    try {
      setSessions(await listSessions(baseUrl, sphereId, ownerId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [baseUrl, sphereId, ownerId]);

  useEffect(() => {
    void refreshSessions();
    setActiveId(undefined);
    setMessages([]);
  }, [refreshSessions]);

  async function openSession(id: string): Promise<void> {
    setError(undefined);
    try {
      const detail = await getSession(baseUrl, sphereId, id, ownerId);
      setActiveId(id);
      setMessages(detail.messages);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function newConversation(): Promise<void> {
    if (ownerId === "" || agentId === "") return;
    setBusy(true);
    setError(undefined);
    try {
      const s = await createSession(baseUrl, sphereId, subject(), agentId, undefined);
      await refreshSessions();
      setActiveId(s.id);
      setMessages([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function send(): Promise<void> {
    if (activeId === undefined || input.trim() === "") return;
    setBusy(true);
    setError(undefined);
    try {
      await postChatTurn(baseUrl, sphereId, activeId, subject(), input.trim());
      setInput("");
      const detail = await getSession(baseUrl, sphereId, activeId, ownerId);
      setMessages(detail.messages);
      await refreshSessions();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "16rem 1fr", gap: "1rem", marginTop: "1rem" }}>
      <aside>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
          <label>
            as{" "}
            <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.role}
                </option>
              ))}
            </select>
          </label>
          <label>
            agent{" "}
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" disabled={busy || agentId === ""} onClick={() => void newConversation()}>
          + New conversation
        </button>
        <ul style={{ listStyle: "none", padding: 0, marginTop: "0.5rem", display: "grid", gap: "0.25rem" }}>
          {sessions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => void openSession(s.id)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: s.id === activeId ? "#2a2d34" : "transparent",
                  color: "inherit",
                  border: "1px solid #2a2d34",
                  borderRadius: 6,
                  padding: "0.4rem 0.5rem",
                  cursor: "pointer",
                }}
              >
                {s.title} <span style={{ color: "#9aa0a6", fontSize: "0.8rem" }}>({s.messageCount})</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section>
        {error !== undefined ? <p style={{ color: "#f28b82" }}>{error}</p> : null}
        {activeId === undefined ? (
          <p style={{ color: "#9aa0a6" }}>Start or open a conversation.</p>
        ) : (
          <>
            <div style={{ display: "grid", gap: "0.5rem", marginBottom: "0.75rem" }}>
              {messages.map((m) => (
                <div key={m.id} style={{ justifySelf: m.role === "user" ? "end" : "start", maxWidth: "80%" }}>
                  <div
                    style={{
                      background: m.role === "user" ? "#1f3a5f" : "#2a2d34",
                      borderRadius: 8,
                      padding: "0.5rem 0.75rem",
                    }}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void send();
                }}
                placeholder="Message your agent…"
                style={{ flex: 1 }}
              />
              <button type="button" disabled={busy || input.trim() === ""} onClick={() => void send()}>
                Send
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
