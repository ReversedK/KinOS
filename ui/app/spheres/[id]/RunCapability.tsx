"use client";

import { useState } from "react";

import { CLIENT_API_BASE, ageProfileForRole, executeCapability, type ActingSubject, type CatalogCapability } from "../../../lib/api";
import { describeOutcome } from "../../../lib/outcome";
import { isAgentFacing } from "../../../components/CapabilityPicker";

export interface RunMember {
  readonly id: string;
  readonly role: string;
}

/**
 * Test a governed capability as a chosen member (RFC-003; the member selector
 * anticipates RFC-006 impersonation). It triggers the governed endpoint and
 * shows the outcome (executed / approval / denied) — the Policy Engine decides,
 * not the UI. Useful to confirm allow-for-adult / deny-for-child behavior.
 */
export function RunCapability({
  sphereId,
  members,
  capabilities,
}: {
  sphereId: string;
  members: readonly RunMember[];
  capabilities?: readonly CatalogCapability[];
}) {
  const options = (capabilities ?? []).filter((c) => isAgentFacing(c.name)).map((c) => c.name);
  const [capability, setCapability] = useState(options[0] ?? "calendar.create_event");
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [note, setNote] = useState<{ tone: string; text: string }>();
  const [busy, setBusy] = useState(false);

  async function run(): Promise<void> {
    const member = members.find((m) => m.id === memberId);
    if (member === undefined) return;
    setBusy(true);
    setNote(undefined);
    try {
      const subject: ActingSubject = { memberId: member.id, role: member.role, ageProfile: ageProfileForRole(member.role) };
      const res = await executeCapability(CLIENT_API_BASE, sphereId, capability.trim(), subject);
      setNote(describeOutcome(res));
    } catch (e) {
      setNote({ tone: "deny", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack tight">
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field">
          <label>Acting member</label>
          <select className="select" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.role} · {m.id}
              </option>
            ))}
          </select>
        </div>
        <div className="field grow">
          <label>Capability</label>
          <input className="input" list="cap-list" value={capability} onChange={(e) => setCapability(e.target.value)} placeholder="calendar.create_event" />
          <datalist id="cap-list">
            {options.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </div>
        <button className="btn" disabled={busy || memberId === ""} onClick={() => void run()}>
          {busy ? <span className="spin" /> : null} Run
        </button>
      </div>
      {note ? <div className={`note ${note.tone}`}>{note.text}</div> : null}
    </div>
  );
}
