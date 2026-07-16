"use client";

import { useState } from "react";

import { CLIENT_API_BASE, executeCapability, type ActingSubject } from "../lib/api";
import { describeOutcome } from "../lib/outcome";

/**
 * Family Notes panel (RFC-013/015): capture a note and search notes as the
 * current actor, through the governed capability endpoints. The console decides
 * nothing (RFC-003) — it triggers `memory.capture` / `memory.search` and shows the
 * governed outcome. Search is policy-scoped by the core resolver, so the actor
 * only ever sees notes they are authorized to read; a denial (e.g. Family Notes
 * not enabled/granted) surfaces as a governed message.
 */
interface NoteHit {
  readonly id: string;
  readonly content: string;
  readonly visibility: string;
}

export function Notes({ sphereId, actor }: { sphereId: string; actor: ActingSubject }) {
  const [content, setContent] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<NoteHit[]>();
  const [note, setNote] = useState<{ tone: string; text: string }>();
  const [busy, setBusy] = useState<"capture" | "search">();

  async function search(): Promise<void> {
    setBusy("search");
    setNote(undefined);
    try {
      const res = await executeCapability(CLIENT_API_BASE, sphereId, "memory.search", actor, { query: query.trim() });
      if (res.status === undefined) {
        setHits(undefined);
        setNote(describeOutcome(res));
        return;
      }
      const items = ((res.output as { items?: NoteHit[] })?.items ?? []) as NoteHit[];
      setHits(items);
    } catch (e) {
      setNote({ tone: "deny", text: (e as Error).message });
    } finally {
      setBusy(undefined);
    }
  }

  async function capture(): Promise<void> {
    if (content.trim() === "") return;
    setBusy("capture");
    setNote(undefined);
    try {
      const res = await executeCapability(CLIENT_API_BASE, sphereId, "memory.capture", actor, { content: content.trim() });
      setNote(describeOutcome(res));
      if (res.status === "executed") {
        setContent("");
        await search();
      }
    } catch (e) {
      setNote({ tone: "deny", text: (e as Error).message });
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className="stack">
      <p className="section-intro">
        Notes are canonical memory. Capturing records a <strong>private</strong> note owned by the acting member; searching returns only
        what that member is authorized to read (policy-scoped per item). Requires the <code>Family Notes</code> package installed and enabled.
      </p>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field grow">
          <label>New note</label>
          <input
            className="input"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="e.g. Dentist appointment moved to Friday"
            onKeyDown={(e) => e.key === "Enter" && void capture()}
          />
        </div>
        <button className="btn" disabled={busy !== undefined || content.trim() === ""} onClick={() => void capture()}>
          {busy === "capture" ? <span className="spin" /> : null} Capture
        </button>
      </div>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field grow">
          <label>Search notes</label>
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="filter by text (blank = all authorized)"
            onKeyDown={(e) => e.key === "Enter" && void search()}
          />
        </div>
        <button className="btn ghost" disabled={busy !== undefined} onClick={() => void search()}>
          {busy === "search" ? <span className="spin" /> : null} Search
        </button>
      </div>
      {note ? <div className={`note ${note.tone}`}>{note.text}</div> : null}
      {hits !== undefined ? (
        hits.length === 0 ? (
          <div className="empty">No notes visible to this member.</div>
        ) : (
          <ul className="stack tight" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {hits.map((h) => (
              <li key={h.id} className="row between" style={{ gap: "var(--s4)", padding: "var(--s2) 0", borderBottom: "1px solid var(--line)" }}>
                <span>{h.content}</span>
                <code className="faint" style={{ fontSize: 12 }}>{h.visibility}</code>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
