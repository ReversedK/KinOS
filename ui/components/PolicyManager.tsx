"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  CLIENT_API_BASE,
  managePolicy,
  type ActingSubject,
  type CatalogCapability,
  type PolicyEffect,
  type SpherePolicy,
} from "../lib/api";
import { describeOutcome } from "../lib/outcome";

const ROLES = ["parent", "teenager", "child", "guest"] as const;
const EFFECT_LABEL: Record<PolicyEffect, string> = {
  allow: "Allow",
  deny: "Deny",
  require_approval: "Require approval",
};

export function PolicyManager({
  sphereId,
  actor,
  policies,
  capabilities,
}: {
  sphereId: string;
  actor: ActingSubject;
  policies: readonly SpherePolicy[];
  capabilities: readonly CatalogCapability[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState("parent");
  const [capability, setCapability] = useState(capabilities[0]?.name ?? "");
  const [effect, setEffect] = useState<PolicyEffect>("allow");
  const [approverRole, setApproverRole] = useState("parent");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState<string>();
  const [note, setNote] = useState<{ tone: string; text: string }>();

  async function persist(policy: SpherePolicy): Promise<void> {
    setBusy(policy.id);
    setNote(undefined);
    try {
      const result = await managePolicy(CLIENT_API_BASE, sphereId, actor, policy);
      setNote(describeOutcome(result));
      if (result.status === "executed") {
        setOpen(false);
        setDescription("");
        router.refresh();
      }
    } catch (error) {
      setNote({ tone: "deny", text: (error as Error).message });
    } finally {
      setBusy(undefined);
    }
  }

  async function create(): Promise<void> {
    if (capability === "" || description.trim() === "") return;
    const id = `pol_${sphereId}_ui_${Date.now().toString(36)}`;
    await persist({
      id,
      sphereId,
      description: description.trim(),
      subjectSelector: { roles: [role] },
      action: "execute",
      resourceSelector: { capabilityNames: [capability] },
      effect,
      ...(effect === "require_approval" ? { approverRoles: [approverRole] } : {}),
      priority: effect === "deny" ? 100 : 10,
      version: 1,
      status: "active",
    });
  }

  async function toggle(policy: SpherePolicy): Promise<void> {
    await persist({
      ...policy,
      version: policy.version + 1,
      status: policy.status === "active" ? "disabled" : "active",
    });
  }

  return (
    <div className="stack">
      <div className="row between">
        <div>
          <p className="section-intro">Rules are evaluated before any agent or model. A missing allow rule means denial.</p>
          <div className="row" style={{ marginTop: 8 }}>
            <span className="badge allow">{policies.filter((p) => p.status === "active" && p.effect === "allow").length} allow</span>
            <span className="badge deny">{policies.filter((p) => p.status === "active" && p.effect === "deny").length} deny</span>
            <span className="badge pending">{policies.filter((p) => p.status === "active" && p.effect === "require_approval").length} approval</span>
          </div>
        </div>
        <button className="btn primary" onClick={() => setOpen((value) => !value)}>+ New rule</button>
      </div>

      {open ? (
        <div className="rule-builder reveal">
          <div className="rule-sentence">
            <span>For</span>
            <select className="select inline-select" value={role} onChange={(event) => setRole(event.target.value)}>
              {ROLES.map((value) => <option key={value}>{value}</option>)}
            </select>
            <select className="select inline-select effect-select" value={effect} onChange={(event) => setEffect(event.target.value as PolicyEffect)}>
              {Object.entries(EFFECT_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <span>the capability</span>
            <select className="select inline-select capability-select" value={capability} onChange={(event) => setCapability(event.target.value)}>
              {capabilities.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
            </select>
          </div>
          {effect === "require_approval" ? (
            <div className="field compact-field">
              <label>Approver role</label>
              <select className="select" value={approverRole} onChange={(event) => setApproverRole(event.target.value)}>
                {ROLES.map((value) => <option key={value}>{value}</option>)}
              </select>
            </div>
          ) : null}
          <div className="field">
            <label>Human-readable reason</label>
            <input className="input" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Parents may create calendar events for the family." />
          </div>
          <div className="row">
            <button className="btn primary" disabled={busy !== undefined || description.trim() === ""} onClick={() => void create()}>{busy ? <span className="spin" /> : null} Create active rule</button>
            <button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      ) : null}

      <div className="policy-list">
        {policies.map((policy) => (
          <article className={`policy-row ${policy.status !== "active" ? "is-disabled" : ""}`} key={policy.id}>
            <span className={`decision-mark ${policy.effect}`} />
            <div className="policy-main">
              <div className="row">
                <span className={`badge ${policy.effect === "require_approval" ? "pending" : policy.effect}`}>{EFFECT_LABEL[policy.effect]}</span>
                <strong>{policy.description}</strong>
              </div>
              <div className="policy-scope">
                <span>{policy.subjectSelector.roles?.join(", ") ?? "all roles"}</span>
                <span>→</span>
                <code>{policy.resourceSelector.capabilityNames?.join(", ") ?? "any capability"}</code>
                {policy.approverRoles ? <span>· approval by {policy.approverRoles.join(", ")}</span> : null}
              </div>
              <span className="faint mono">{policy.id} · v{policy.version}</span>
            </div>
            <div className="policy-actions">
              <span className={`badge ${policy.status === "active" ? "allow" : ""}`}>{policy.status}</span>
              <button className="btn sm" disabled={busy !== undefined} onClick={() => void toggle(policy)}>
                {busy === policy.id ? <span className="spin" /> : null}{policy.status === "active" ? "Disable" : "Activate"}
              </button>
            </div>
          </article>
        ))}
      </div>
      {note ? <div className={`note ${note.tone}`}>{note.text}</div> : null}
    </div>
  );
}
