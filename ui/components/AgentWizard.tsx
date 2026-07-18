"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  CLIENT_API_BASE,
  deployAgent,
  getAgentRuntimeProjection,
  projectAgentRuntimeConfig,
  type ActingSubject,
  type CatalogCapability,
  type MemberSummary,
  type RuntimeProjection,
} from "../lib/api";
import { describeOutcome } from "../lib/outcome";
import { CapabilityPicker } from "./CapabilityPicker";

/**
 * Agent onboarding wizard (RFC-023). Sequences existing governed operations into
 * one path: identity → scope → review & project → reachable. It only triggers;
 * the Policy Engine decides (coding principle 1). The final step is a handoff to
 * Hermes for the messaging channel — KinOS governs what the agent may do, not the
 * transport (RFC-007), so the wizard writes no channel credential.
 */
const STEPS = ["Identity", "Scope", "Review & project", "Reachable"] as const;

export function AgentWizard({
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
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: string; text: string }>();

  const [ownerId, setOwnerId] = useState(members[0]?.id ?? "");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<string[]>([]);
  const [agentId, setAgentId] = useState<string>();
  const [projection, setProjection] = useState<RuntimeProjection | { denied: string }>();
  // Projection is approval-floored (RFC-007): committing it may execute or route for
  // approval. The finish step tells the truth about which happened.
  const [projectStatus, setProjectStatus] = useState<"none" | "executed" | "pending">("none");

  function reset(): void {
    setStep(0);
    setBusy(false);
    setNote(undefined);
    setName("");
    setScope([]);
    setAgentId(undefined);
    setProjection(undefined);
    setProjectStatus("none");
    setOwnerId(members[0]?.id ?? "");
  }

  // Step 2 → deploy the agent (agent.create, RFC-008) and capture its id.
  async function deploy(): Promise<void> {
    setBusy(true);
    setNote(undefined);
    try {
      const res = await deployAgent(CLIENT_API_BASE, sphereId, admin, { ownerId, name: name.trim(), capabilities: scope });
      if (res.status === "executed" && typeof res.output === "object" && res.output !== null && "agentId" in res.output) {
        setAgentId((res.output as { agentId: string }).agentId);
        setNote(undefined);
        setStep(2);
        void loadProjection((res.output as { agentId: string }).agentId);
        router.refresh();
      } else {
        setNote(describeOutcome(res));
      }
    } catch (e) {
      setNote({ tone: "deny", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  // Step 3 preview → the governed runtime projection (RFC-007), read-only.
  async function loadProjection(id: string): Promise<void> {
    setProjection(undefined);
    try {
      const p = await getAgentRuntimeProjection(CLIENT_API_BASE, sphereId, id, admin);
      setProjection(p.code === "forbidden" ? { denied: p.reason ?? "forbidden" } : p);
    } catch (e) {
      setProjection({ denied: (e as Error).message });
    }
  }

  // Step 3 commit → write the Hermes profile + provision the per-agent token.
  async function project(): Promise<void> {
    if (agentId === undefined) return;
    setBusy(true);
    setNote(undefined);
    try {
      const res = await projectAgentRuntimeConfig(CLIENT_API_BASE, sphereId, admin, { agentId });
      // Approval-floored (RFC-007): executed now, or routed for another adult to grant.
      if (res.status === "executed") {
        setProjectStatus("executed");
        setStep(3);
        router.refresh();
      } else if (res.status === "pending_approval") {
        setProjectStatus("pending");
        setStep(3);
        router.refresh();
      } else {
        setNote(describeOutcome(res));
      }
    } catch (e) {
      setNote({ tone: "deny", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn sm" onClick={() => { reset(); setOpen(true); }}>
        ＋ Deploy agent
      </button>
    );
  }

  const allowed = projection !== undefined && !("denied" in projection) ? projection.allowedTools : [];

  return (
    <div className="stack" style={{ width: "100%" }}>
      {/* Stepper */}
      <ol className="stepper">
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? "active" : i < step ? "done" : undefined}>
            <span className="step-num">{i < step ? "✓" : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {/* Step 1 — Identity */}
      {step === 0 ? (
        members.length === 0 ? (
          <div className="empty">
            <span className="empty-glyph">☺</span>
            No members to own an agent yet. Invite one in the Members section first.
          </div>
        ) : (
          <div className="stack tight">
            <div className="row" style={{ alignItems: "flex-end" }}>
              <div className="field grow">
                <label htmlFor="aw-name">Agent name</label>
                <input id="aw-name" className="input" value={name} placeholder="Jordan's agent" onChange={(e) => setName(e.target.value)} autoFocus />
              </div>
              <div className="field">
                <label htmlFor="aw-owner">Owner</label>
                <select id="aw-owner" className="select" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.role} · {m.id}</option>
                  ))}
                </select>
              </div>
            </div>
            <span className="hint">The agent represents this member. What it may do is decided by policy, per call — never by ownership alone.</span>
          </div>
        )
      ) : null}

      {/* Step 2 — Scope */}
      {step === 1 ? (
        <div className="stack tight">
          <div className="field">
            <label>Capability scope</label>
            <CapabilityPicker capabilities={capabilities} selected={scope} onChange={setScope} />
            <span className="hint">{scope.length} selected · a request surface only; each call is still policy-checked (deny by default).</span>
          </div>
        </div>
      ) : null}

      {/* Step 3 — Review & project */}
      {step === 2 ? (
        <div className="stack tight">
          <span className="eyebrow">Governed runtime projection (RFC-007)</span>
          {projection === undefined ? (
            <span className="faint"><span className="spin" /> computing projection…</span>
          ) : "denied" in projection ? (
            <div className="note deny">Denied — {projection.denied}</div>
          ) : (
            <>
              <div className="tablewrap">
                <table className="grid-table">
                  <tbody>
                    <tr><td className="faint">provider · model</td><td><code>{projection.provider}</code> · <code>{projection.model}</code> · {projection.execution}</td></tr>
                    <tr><td className="faint">sphere MCP gateway</td><td><code>{projection.gatewayEndpoint}</code></td></tr>
                    <tr><td className="faint">auth</td><td>by reference · <code>{projection.authSecretRef}</code></td></tr>
                    <tr>
                      <td className="faint">native toolsets</td>
                      <td>
                        {projection.nativeToolsetsAllow.length === 0
                          ? <span className="faint">none</span>
                          : projection.nativeToolsetsAllow.map((t) => <code key={t} className="pill" style={{ marginRight: 4 }}>{t}</code>)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {/* Requested vs. actually authorized — the honest gap. */}
              <div className="field">
                <label>Requested scope vs. what policy authorizes</label>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  {scope.length === 0 ? <span className="faint">No capabilities requested.</span> : scope.map((c) => {
                    const ok = allowed.includes(c);
                    return (
                      <code key={c} className={`pill ${ok ? "" : "deny"}`} title={ok ? "authorized now" : "not yet authorized — needs a policy grant or approval"}>
                        {ok ? "✓ " : "• "}{c}
                      </code>
                    );
                  })}
                </div>
                <span className="hint">
                  {allowed.length} of {scope.length} authorized now. Unauthorized capabilities are denied by default until a policy grants them — the agent can still be projected; it simply cannot use them yet.
                </span>
              </div>
            </>
          )}
        </div>
      ) : null}

      {/* Step 4 — Reachable (handoff to Hermes). Honest about the approval floor:
          projection may be executed now, or awaiting another adult's grant. */}
      {step === 3 ? (
        <div className="stack tight">
          {projectStatus === "pending" ? (
            <div className="note pending">
              <strong>{name.trim() || "The agent"} is deployed and scoped.</strong> Projecting its Hermes profile is approval-floored (RFC-007)
              and has been routed for a decision — another adult must grant it in <strong>Access → Approvals</strong>. It becomes reachable once approved.
            </div>
          ) : (
            <div className="note allow">
              <strong>{name.trim() || "The agent"} is governed and reachable.</strong> It has a Hermes profile and its own per-agent token.
            </div>
          )}
          <p className="section-intro">
            To let a person reach it over WhatsApp, Telegram or Signal, connect a channel <strong>in Hermes</strong>. KinOS governs what the
            agent may do — every action runs through the Sphere MCP and is policy-checked — while Hermes routes the channel to this agent's
            profile. The channel is Hermes' concern by design (RFC-007), so nothing about it is configured here.
          </p>
          <div className="tablewrap">
            <table className="grid-table">
              <tbody>
                <tr><td className="faint">agent</td><td><code>{agentId}</code></td></tr>
                <tr>
                  <td className="faint">profile</td>
                  <td>{projectStatus === "executed" ? "projected to Hermes ✓" : <span>projection <span className="badge pending"><span className="dot" />awaiting approval</span></span>}</td>
                </tr>
                <tr><td className="faint">channel</td><td>connect in Hermes · <span className="faint">hermes-agent.nousresearch.com/docs — Messaging</span></td></tr>
              </tbody>
            </table>
          </div>
          {projectStatus === "pending" ? (
            <a className="btn sm ghost" href={`/spheres/${encodeURIComponent(sphereId)}/access`}>Go to Approvals →</a>
          ) : null}
        </div>
      ) : null}

      {note ? <div className={`note ${note.tone}`}>{note.text}</div> : null}

      {/* Controls */}
      <div className="row between">
        <button className="btn ghost sm" onClick={() => setOpen(false)}>
          {step === 3 ? "Close" : "Cancel"}
        </button>
        <div className="row" style={{ gap: "var(--s2)" }}>
          {step > 0 && step < 3 && projectStatus === "none" ? (
            <button className="btn ghost sm" disabled={busy} onClick={() => { setNote(undefined); setStep((s) => s - 1); }}>
              Back
            </button>
          ) : null}
          {step === 0 ? (
            <button className="btn primary sm" disabled={members.length === 0 || name.trim() === "" || ownerId === ""} onClick={() => { setNote(undefined); setStep(1); }}>
              Next
            </button>
          ) : null}
          {step === 1 ? (
            <button className="btn primary sm" disabled={busy} onClick={() => void deploy()}>
              {busy ? <span className="spin" /> : null} Deploy agent
            </button>
          ) : null}
          {step === 2 ? (
            <button className="btn primary sm" disabled={busy || projection === undefined || "denied" in (projection ?? {})} onClick={() => void project()}>
              {busy ? <span className="spin" /> : null} Project to Hermes
            </button>
          ) : null}
          {step === 3 ? (
            <button className="btn primary sm" onClick={() => { reset(); setOpen(false); }}>
              Done
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
