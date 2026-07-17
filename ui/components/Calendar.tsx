"use client";

import { useState } from "react";

import { CLIENT_API_BASE, executeCapability, type ActingSubject } from "../lib/api";
import { describeOutcome } from "../lib/outcome";

/**
 * Family Calendar panel (RFC-012): list the Sphere's events and propose a new one,
 * through the governed capability endpoints. The console decides nothing (RFC-003):
 * `calendar.read` returns the Sphere-scoped events; `calendar.create_event` is
 * governed and — per the Family Calendar grant — proposes the event for approval,
 * so a create surfaces as "approval required, routed to the inbox" rather than an
 * immediate write. Requires the Family Calendar package installed and enabled.
 */
interface CalEvent {
  readonly id: string;
  readonly title: string;
  readonly start: string;
  readonly createdBy?: string;
}

export function Calendar({ sphereId, actor }: { sphereId: string; actor: ActingSubject }) {
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [events, setEvents] = useState<CalEvent[]>();
  const [note, setNote] = useState<{ tone: string; text: string }>();
  const [busy, setBusy] = useState<"read" | "create">();

  async function read(): Promise<void> {
    setBusy("read");
    setNote(undefined);
    try {
      const res = await executeCapability(CLIENT_API_BASE, sphereId, "calendar.read", actor, {});
      if (res.status === undefined) {
        setEvents(undefined);
        setNote(describeOutcome(res));
        return;
      }
      setEvents(((res.output as { events?: CalEvent[] })?.events ?? []) as CalEvent[]);
    } catch (e) {
      setNote({ tone: "deny", text: (e as Error).message });
    } finally {
      setBusy(undefined);
    }
  }

  async function create(): Promise<void> {
    if (title.trim() === "") return;
    setBusy("create");
    setNote(undefined);
    try {
      const startIso = start.trim() === "" ? new Date().toISOString() : new Date(start).toISOString();
      const res = await executeCapability(CLIENT_API_BASE, sphereId, "calendar.create_event", actor, { title: title.trim(), start: startIso });
      setNote(describeOutcome(res));
      if (res.status === "executed") {
        setTitle("");
        setStart("");
        await read();
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
        A local-first, Sphere-scoped calendar. Listing shows this Sphere&apos;s events; proposing an event is governed — the Family Calendar
        grant routes it for a parent&apos;s approval before it is written. Requires the <code>Family Calendar</code> package enabled.
      </p>
      <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <div className="field grow">
          <label>Event</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Piano lesson" />
        </div>
        <div className="field">
          <label>Start</label>
          <input className="input" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <button className="btn" disabled={busy !== undefined || title.trim() === ""} onClick={() => void create()}>
          {busy === "create" ? <span className="spin" /> : null} Propose
        </button>
        <button className="btn ghost" disabled={busy !== undefined} onClick={() => void read()}>
          {busy === "read" ? <span className="spin" /> : null} Refresh
        </button>
      </div>
      {note ? <div className={`note ${note.tone}`}>{note.text}</div> : null}
      {events !== undefined ? (
        events.length === 0 ? (
          <div className="empty"><span className="empty-glyph">◷</span>No events yet. Add one above, or an agent can propose one for approval.</div>
        ) : (
          <ul className="stack tight" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {events.map((e) => (
              <li key={e.id} className="row between" style={{ gap: "var(--s4)", padding: "var(--s2) 0", borderBottom: "1px solid var(--line)" }}>
                <span>{e.title}</span>
                <code className="faint" style={{ fontSize: 12 }}>{new Date(e.start).toLocaleString()}</code>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
