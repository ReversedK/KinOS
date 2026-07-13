"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { CLIENT_API_BASE, createSphereRequest, type ActingSubject } from "../lib/api";
import { describeOutcome } from "../lib/outcome";

const TYPES = ["family", "person", "team", "organization"] as const;

/**
 * Create a Sphere (RFC-008 bootstrap). The acting subject is the local operator
 * (an adult); the founder becomes the first administrator. The Policy Engine
 * authorizes against the bootstrap policy set — the UI only triggers it.
 */
export function CreateSphere() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]>("family");
  const [founderName, setFounderName] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: string; text: string }>();

  async function submit(): Promise<void> {
    if (name.trim() === "") return;
    setBusy(true);
    setNote(undefined);
    // Bootstrap: the local operator is an adult (deny-by-default otherwise).
    const operator: ActingSubject = { role: "parent", ageProfile: "adult" };
    try {
      const res = await createSphereRequest(CLIENT_API_BASE, operator, {
        name: name.trim(),
        type,
        ...(founderName.trim() !== "" ? { founderName: founderName.trim() } : {}),
      });
      setNote(describeOutcome(res));
      const newId = (res.output as { sphereId?: string } | undefined)?.sphereId;
      if (res.status === "executed" && newId) {
        router.push(`/spheres/${encodeURIComponent(newId)}`);
        router.refresh();
      }
    } catch (e) {
      setNote({ tone: "deny", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn primary" onClick={() => setOpen(true)}>
        ＋ New Sphere
      </button>
    );
  }

  return (
    <div className="panel" style={{ maxWidth: 520 }}>
      <div className="panel-head">
        <h3>Create a Sphere</h3>
        <button className="btn ghost sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <div className="panel-body stack">
        <div className="field">
          <label htmlFor="cs-name">Name</label>
          <input id="cs-name" className="input" value={name} placeholder="Doe Family" onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="row" style={{ gap: "var(--s4)" }}>
          <div className="field grow">
            <label htmlFor="cs-type">Type</label>
            <select id="cs-type" className="select" value={type} onChange={(e) => setType(e.target.value as (typeof TYPES)[number])}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="field grow">
            <label htmlFor="cs-founder">Founder / administrator name</label>
            <input id="cs-founder" className="input" value={founderName} placeholder="optional" onChange={(e) => setFounderName(e.target.value)} />
          </div>
        </div>
        <p className="hint">
          The founder becomes the Sphere&apos;s first administrator. A default admin policy is seeded so you can invite members and deploy agents right away.
        </p>
        {note ? <div className={`note ${note.tone}`}>{note.text}</div> : null}
        <div className="row">
          <button className="btn primary" disabled={busy || name.trim() === ""} onClick={() => void submit()}>
            {busy ? <span className="spin" /> : null} Create Sphere
          </button>
        </div>
      </div>
    </div>
  );
}
