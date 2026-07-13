"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { CLIENT_API_BASE, deployAgent, type ActingSubject, type CatalogCapability, type MemberSummary } from "../lib/api";
import { describeOutcome } from "../lib/outcome";
import { CapabilityPicker } from "./CapabilityPicker";

/**
 * Deploy a permissioned agent for a member (RFC-008 `agent.create`). The chosen
 * capabilities are the agent's request scope — deploying is not authorizing; each
 * call is still policy-checked. Acts as the Sphere administrator.
 */
export function DeployAgent({
  sphereId,
  admin,
  members,
  capabilities,
}: {
  sphereId: string;
  admin: ActingSubject;
  members: readonly MemberSummary[];
  capabilities: readonly CatalogCapability[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ownerId, setOwnerId] = useState(members[0]?.id ?? "");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: string; text: string }>();

  async function submit(): Promise<void> {
    if (name.trim() === "" || ownerId === "") return;
    setBusy(true);
    setNote(undefined);
    try {
      const res = await deployAgent(CLIENT_API_BASE, sphereId, admin, {
        ownerId,
        name: name.trim(),
        capabilities: scope,
        ...(model.trim() !== "" ? { model: model.trim() } : {}),
      });
      setNote(describeOutcome(res));
      if (res.status === "executed") {
        setName("");
        setScope([]);
        setModel("");
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
        ＋ Deploy agent
      </button>
    );
  }

  return (
    <div className="stack" style={{ width: "100%" }}>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field grow">
          <label htmlFor="da-name">Agent name</label>
          <input id="da-name" className="input" value={name} placeholder="Jordan's agent" onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="da-owner">Owner</label>
          <select id="da-owner" className="select" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.role} · {m.id}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Model preference (optional)</label>
        <input className="input" value={model} placeholder="e.g. hermes-agent · qwen3-128k" onChange={(e) => setModel(e.target.value)} />
        <span className="hint">Advisory tag; swapping the model is &ldquo;boring&rdquo; — no new identity, no memory change.</span>
      </div>
      <div className="field">
        <label>Capability scope</label>
        <CapabilityPicker capabilities={capabilities} selected={scope} onChange={setScope} />
        <span className="hint">{scope.length} selected · a request surface only; each call is still policy-checked.</span>
      </div>
      {note ? <div className={`note ${note.tone}`}>{note.text}</div> : null}
      <div className="row">
        <button className="btn primary" disabled={busy || name.trim() === "" || ownerId === ""} onClick={() => void submit()}>
          {busy ? <span className="spin" /> : null} Deploy agent
        </button>
        <button className="btn ghost sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
