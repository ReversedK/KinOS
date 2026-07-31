"use client";

import { useEffect, useState } from "react";

import { CLIENT_API_BASE, executeCapability, type ActingSubject } from "../lib/api";
import { describeOutcome } from "../lib/outcome";

/**
 * Documents panel (RFC-048). Upload a document, search the Sphere's documents
 * source, and summarize one — all through the governed capability endpoints
 * (`document.upload` / `document.search` / `document.summarize`). The console
 * decides nothing (RFC-003): it triggers the capability and shows the governed
 * outcome. Upload only succeeds on a WRITABLE source (the `minio` provider);
 * `local` / `google_drive` refuse it and the denial surfaces as a governed message.
 */
interface DocHit {
  readonly id: string;
  readonly content: string;
}

export function Documents({ sphereId, actor }: { sphereId: string; actor: ActingSubject }) {
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [query, setQuery] = useState("");
  const [docs, setDocs] = useState<readonly DocHit[]>();
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [note, setNote] = useState<{ tone: string; text: string }>();
  const [busy, setBusy] = useState<"upload" | "search" | string>();

  async function search(): Promise<void> {
    setBusy("search");
    setNote(undefined);
    try {
      const res = await executeCapability(CLIENT_API_BASE, sphereId, "document.search", actor, { query: query.trim() });
      if (res.status === undefined) {
        setDocs(undefined);
        setNote(describeOutcome(res));
        return;
      }
      setDocs(((res.output as { documents?: DocHit[] })?.documents ?? []) as DocHit[]);
    } catch (e) {
      setNote({ tone: "deny", text: (e as Error).message });
    } finally {
      setBusy(undefined);
    }
  }

  // Load the current documents once on mount (empty query = list all authorized).
  useEffect(() => {
    void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function upload(): Promise<void> {
    if (name.trim() === "" || content.trim() === "") return;
    setBusy("upload");
    setNote(undefined);
    try {
      const res = await executeCapability(CLIENT_API_BASE, sphereId, "document.upload", actor, { name: name.trim(), content });
      setNote(describeOutcome(res));
      if (res.status === "executed") {
        setName("");
        setContent("");
        await search();
      }
    } catch (e) {
      setNote({ tone: "deny", text: (e as Error).message });
    } finally {
      setBusy(undefined);
    }
  }

  async function summarize(id: string): Promise<void> {
    setBusy(`sum:${id}`);
    setNote(undefined);
    try {
      const res = await executeCapability(CLIENT_API_BASE, sphereId, "document.summarize", actor, { documentId: id });
      if (res.status === "executed") {
        const summary = (res.output as { summary?: string })?.summary ?? "";
        setSummaries((s) => ({ ...s, [id]: summary }));
      } else {
        setNote(describeOutcome(res));
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
        Documents live in the Sphere's connected source. <strong>Uploading</strong> needs a writable source (the <code>minio</code>
        provider) and the <code>Documents</code> package enabled with an upload grant; searching and summarizing are policy-scoped.
        The Policy Engine gates every action — a denial (wrong provider, no grant, minor) surfaces below.
      </p>

      {/* Upload */}
      <div className="field">
        <label>Upload a document</label>
        <input className="input" placeholder="File name (e.g. recipe.txt)" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <textarea className="input" rows={4} placeholder="Document text…" value={content} onChange={(e) => setContent(e.target.value)} />
      </div>
      <div className="row">
        <button className="btn primary" disabled={busy === "upload" || name.trim() === "" || content.trim() === ""} onClick={() => void upload()}>
          {busy === "upload" ? <span className="spin" /> : null} Upload
        </button>
      </div>

      <hr className="hairline" />

      {/* Search + list */}
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field grow">
          <label>Search documents</label>
          <input
            className="input"
            placeholder="Match name or text; empty lists all"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void search();
            }}
          />
        </div>
        <button className="btn" disabled={busy === "search"} onClick={() => void search()}>
          {busy === "search" ? <span className="spin" /> : null} Search
        </button>
      </div>

      {note ? <div className={`note ${note.tone}`}>{note.text}</div> : null}

      {docs !== undefined ? (
        docs.length === 0 ? (
          <p className="help">No documents yet — upload one above, or connect a source in the Store.</p>
        ) : (
          <div className="stack tight">
            {docs.map((d) => (
              <div key={d.id} className="card stack tight">
                <div className="row between">
                  <strong className="mono" style={{ fontSize: 14 }}>{d.id}</strong>
                  <button className="btn sm ghost" disabled={busy === `sum:${d.id}`} onClick={() => void summarize(d.id)}>
                    {busy === `sum:${d.id}` ? <span className="spin" /> : null} Summarize
                  </button>
                </div>
                {summaries[d.id] !== undefined ? (
                  <p className="help" style={{ margin: 0 }}>{summaries[d.id]}</p>
                ) : (
                  <p className="faint" style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap" }}>
                    {d.content.length > 160 ? `${d.content.slice(0, 160)}…` : d.content}
                  </p>
                )}
              </div>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
