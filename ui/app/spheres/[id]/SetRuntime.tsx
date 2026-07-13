"use client";

import { useState } from "react";

import { CLIENT_API_BASE, ageProfileForRole, setRuntime, type ActingSubject } from "../../../lib/api";
import { describeOutcome } from "../../../lib/outcome";
import type { RunMember } from "./RunCapability";

/**
 * Change the Sphere's inference provider/model (RFC-004) via the governed write
 * endpoint. The UI only triggers it; the Policy Engine decides (admin-only,
 * deny-by-default) and the core refuses disallowed providers / cloud-while-
 * disabled. Selecting a cloud provider engages the external-transfer/consent path.
 */
export function SetRuntime({ sphereId, members }: { sphereId: string; members: readonly RunMember[] }) {
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [provider, setProvider] = useState("ollama");
  const [model, setModel] = useState("qwen3-128k");
  const [note, setNote] = useState<{ tone: string; text: string }>();
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    const member = members.find((m) => m.id === memberId);
    if (member === undefined) return;
    setBusy(true);
    setNote(undefined);
    try {
      const subject: ActingSubject = { memberId: member.id, role: member.role, ageProfile: ageProfileForRole(member.role) };
      const execution = provider === "openai" ? "cloud" : "local";
      const res = await setRuntime(CLIENT_API_BASE, sphereId, subject, { providerId: provider, model: model.trim(), execution });
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
          <label>As</label>
          <select className="select" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.role}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Provider</label>
          <select className="select" value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="ollama">ollama · local</option>
            <option value="hermes">hermes · governed</option>
            <option value="openai">openai · cloud</option>
          </select>
        </div>
        <div className="field grow">
          <label>Model</label>
          <input className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="model / profile" />
        </div>
        <button className="btn" disabled={busy || memberId === ""} onClick={() => void save()}>
          {busy ? <span className="spin" /> : null} Save
        </button>
      </div>
      {provider === "openai" ? <span className="hint">Cloud inference engages the external-transfer / consent path (RFC-004).</span> : null}
      {note ? <div className={`note ${note.tone}`}>{note.text}</div> : null}
    </div>
  );
}
