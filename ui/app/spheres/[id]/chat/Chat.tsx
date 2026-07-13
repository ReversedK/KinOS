"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  CLIENT_API_BASE,
  ageProfileForRole,
  createSession,
  getSession,
  listSessions,
  postChatTurn,
  type ActingSubject,
  type ChatMessage,
  type SessionSummary,
} from "../../../../lib/api";

export interface ChatMember {
  readonly id: string;
  readonly role: string;
}
export interface ChatAgent {
  readonly id: string;
  readonly name: string;
  readonly capabilities: readonly string[];
}

/**
 * Test an agent in real conditions (RFC-005). Owner-private: the acting member
 * (dev selector, anticipating auth/RFC-006) is the session owner. Turns run
 * through the governed runtime — with KINOS_RUNTIME=hermes the agent reaches
 * back into the Sphere MCP for exactly its policy-authorized capabilities. The
 * UI only triggers governed endpoints and renders the transcript it may read.
 */
export function Chat({
  sphereId,
  members,
  agents,
}: {
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
  const endRef = useRef<HTMLDivElement>(null);

  const activeAgent = agents.find((a) => a.id === agentId);

  const subject = (): ActingSubject => {
    const m = members.find((x) => x.id === ownerId);
    return { memberId: ownerId, role: m?.role ?? "guest", ageProfile: ageProfileForRole(m?.role ?? "guest") };
  };

  const refreshSessions = useCallback(async () => {
    if (ownerId === "") return;
    try {
      setSessions(await listSessions(CLIENT_API_BASE, sphereId, ownerId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [sphereId, ownerId]);

  useEffect(() => {
    void refreshSessions();
    setActiveId(undefined);
    setMessages([]);
  }, [refreshSessions]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function openSession(sid: string): Promise<void> {
    setError(undefined);
    try {
      const detail = await getSession(CLIENT_API_BASE, sphereId, sid, ownerId);
      setActiveId(sid);
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
      const s = await createSession(CLIENT_API_BASE, sphereId, subject(), agentId, undefined);
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
    const text = input.trim();
    setBusy(true);
    setError(undefined);
    // Optimistic echo of the user's turn.
    setMessages((ms) => [...ms, { id: `local_${Date.now()}`, role: "user", content: text, createdAt: new Date().toISOString() }]);
    setInput("");
    try {
      await postChatTurn(CLIENT_API_BASE, sphereId, activeId, subject(), text);
      const detail = await getSession(CLIENT_API_BASE, sphereId, activeId, ownerId);
      setMessages(detail.messages);
      await refreshSessions();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat-layout">
      <aside className="panel" style={{ alignSelf: "start" }}>
        <div className="panel-body stack tight">
          <div className="field">
            <label>Acting member</label>
            <select className="select" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.role} · {m.id}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Agent</label>
            <select className="select" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <button className="btn primary" disabled={busy || agentId === ""} onClick={() => void newConversation()}>
            ＋ New conversation
          </button>
          <hr className="hairline" style={{ margin: "var(--s2) 0" }} />
          <span className="eyebrow">sessions</span>
          {sessions.length === 0 ? (
            <span className="faint" style={{ fontSize: 12 }}>none yet</span>
          ) : (
            <div className="stack tight">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  className="btn ghost sm"
                  style={{ justifyContent: "space-between", width: "100%", background: s.id === activeId ? "var(--panel-2)" : undefined }}
                  onClick={() => void openSession(s.id)}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
                  <span className="faint">{s.messageCount}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      <section className="panel" style={{ display: "flex", flexDirection: "column", minHeight: "60vh" }}>
        {activeAgent ? (
          <div className="panel-head">
            <div className="row" style={{ gap: "var(--s2)" }}>
              <strong>{activeAgent.name}</strong>
              {activeAgent.capabilities.length === 0 ? (
                <span className="badge">no capabilities</span>
              ) : (
                activeAgent.capabilities.map((c) => (
                  <code key={c} className="pill">
                    {c}
                  </code>
                ))
              )}
            </div>
            <span className="badge info" title="Turns run through the governed runtime (Sphere MCP for authorized capabilities)">
              governed runtime
            </span>
          </div>
        ) : null}

        <div className="panel-body grow" style={{ overflowY: "auto" }}>
          {error !== undefined ? <div className="note deny" style={{ marginBottom: "var(--s3)" }}>{error}</div> : null}
          {activeId === undefined ? (
            <div className="empty">Start or open a conversation to test the agent.</div>
          ) : messages.length === 0 ? (
            <div className="empty">No messages yet — say hello to your agent.</div>
          ) : (
            <div className="stack">
              {messages.map((m) => (
                <div key={m.id} className={`bubble ${m.role === "user" ? "user" : "agent"}`}>
                  <div className="eyebrow" style={{ marginBottom: 4 }}>{m.role}</div>
                  {m.content}
                </div>
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>

        <div className="panel-head" style={{ borderBottom: 0, borderTop: "1px solid var(--line)" }}>
          <input
            className="input"
            value={input}
            disabled={activeId === undefined}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={activeId === undefined ? "Open a conversation first…" : "Message your agent…  (Enter to send)"}
          />
          <button className="btn primary" disabled={busy || activeId === undefined || input.trim() === ""} onClick={() => void send()}>
            {busy ? <span className="spin" /> : "Send"}
          </button>
        </div>
      </section>
    </div>
  );
}
