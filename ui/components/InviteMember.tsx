"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { CLIENT_API_BASE, inviteMember, type ActingSubject } from "../lib/api";
import { describeOutcome } from "../lib/outcome";

const ROLES = ["parent", "teenager", "child", "guest"] as const;

/**
 * Invite (add) a member to a Sphere (RFC-008 `member.invite`). Acts as the
 * Sphere administrator; the Policy Engine authorizes via the seeded admin
 * policy. Minors (child/teenager) are restricted by default downstream.
 */
export function InviteMember({ sphereId, admin }: { sphereId: string; admin: ActingSubject }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("child");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: string; text: string }>();

  async function submit(): Promise<void> {
    if (displayName.trim() === "") return;
    setBusy(true);
    setNote(undefined);
    try {
      const res = await inviteMember(CLIENT_API_BASE, sphereId, admin, { role, displayName: displayName.trim() });
      setNote(describeOutcome(res));
      if (res.status === "executed") {
        setDisplayName("");
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
      <button className="btn sm" onClick={() => setOpen(true)}>
        ＋ Invite member
      </button>
    );
  }

  return (
    <div className="stack tight" style={{ width: "100%" }}>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field grow">
          <label htmlFor="im-name">Display name</label>
          <input id="im-name" className="input" value={displayName} placeholder="Jordan Doe" onChange={(e) => setDisplayName(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="im-role">Role</label>
          <select id="im-role" className="select" value={role} onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <button className="btn primary" disabled={busy || displayName.trim() === ""} onClick={() => void submit()}>
          {busy ? <span className="spin" /> : null} Add
        </button>
        <button className="btn ghost sm" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      {note ? <div className={`note ${note.tone}`}>{note.text}</div> : null}
    </div>
  );
}
