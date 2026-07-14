"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  CLIENT_API_BASE,
  getAgentRuntimeProjection,
  setAgentModel,
  updateAgentConfig,
  type ActingSubject,
  type AgentSummary,
  type CatalogCapability,
  type RuntimeProjection,
} from "../lib/api";
import { describeOutcome } from "../lib/outcome";
import { CapabilityPicker, isAgentFacing } from "./CapabilityPicker";

const STATE_TONE: Record<string, string> = {
  active: "allow",
  configured: "info",
  paused: "pending",
  disabled: "deny",
};

/**
 * Per-agent control surface (RFC-008 `agent.update_config` + RFC-007 projection
 * preview): edit the capability scope, change the model tag, move lifecycle
 * state, and preview the exact governed runtime config KinOS would project to
 * the agent's Hermes profile. Acts as the Sphere administrator.
 */
export function AgentConfig({
  sphereId,
  admin,
  agent,
  capabilities,
}: {
  sphereId: string;
  admin: ActingSubject;
  agent: AgentSummary;
  capabilities: readonly CatalogCapability[];
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<"none" | "scope" | "projection">("none");
  const [scope, setScope] = useState<string[]>([...agent.enabledCapabilities]);
  const [model, setModel] = useState(agent.modelPreference ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: string; text: string }>();
  const [projection, setProjection] = useState<RuntimeProjection | { denied: string }>();

  async function apply(patch: Parameters<typeof updateAgentConfig>[3]): Promise<void> {
    setBusy(true);
    setNote(undefined);
    try {
      const res = await updateAgentConfig(CLIENT_API_BASE, sphereId, admin, patch);
      setNote(describeOutcome(res));
      if (res.status === "executed") router.refresh();
    } catch (e) {
      setNote({ tone: "deny", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  // The model is a governed selection of its own (RFC-009, `model.set`) — routed
  // through the dedicated endpoint, not folded into the broader agent.update_config.
  async function saveModel(): Promise<void> {
    setBusy(true);
    setNote(undefined);
    try {
      const res = await setAgentModel(CLIENT_API_BASE, sphereId, agent.id, admin, model.trim());
      setNote(res.code === "forbidden" ? { tone: "deny", text: `Denied — ${res.message ?? "forbidden"}` } : { tone: "allow", text: `Model set to ${res.model}` });
      if (res.status === "executed") router.refresh();
    } catch (e) {
      setNote({ tone: "deny", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function loadProjection(): Promise<void> {
    setPanel("projection");
    setProjection(undefined);
    try {
      const p = await getAgentRuntimeProjection(CLIENT_API_BASE, sphereId, agent.id, admin);
      setProjection(p.code === "forbidden" ? { denied: p.reason ?? "forbidden" } : p);
    } catch (e) {
      setProjection({ denied: (e as Error).message });
    }
  }

  const scopeDirty = JSON.stringify([...scope].sort()) !== JSON.stringify([...agent.enabledCapabilities].sort());
  const modelDirty = model.trim() !== (agent.modelPreference ?? "");

  return (
    <div className="stack tight" style={{ width: "100%" }}>
      <div className="row between">
        <div className="row" style={{ gap: "var(--s2)" }}>
          <span className={`badge ${STATE_TONE[agent.state] ?? "info"}`}>
            <span className="dot" />
            {agent.state}
          </span>
          <span className="faint">
            {agent.enabledCapabilities.length} cap{agent.enabledCapabilities.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="row" style={{ gap: "var(--s1)" }}>
          {agent.state !== "active" ? (
            <button className="btn sm" disabled={busy} onClick={() => void apply({ agentId: agent.id, state: "active" })}>
              Activate
            </button>
          ) : (
            <button className="btn sm" disabled={busy} onClick={() => void apply({ agentId: agent.id, state: "paused" })}>
              Pause
            </button>
          )}
          <button className="btn ghost sm" onClick={() => setPanel(panel === "scope" ? "none" : "scope")}>
            Configure
          </button>
          <button className="btn ghost sm" onClick={() => void loadProjection()}>
            Projection
          </button>
        </div>
      </div>

      {agent.enabledCapabilities.length > 0 ? (
        <div className="row" style={{ gap: 6 }}>
          {agent.enabledCapabilities.map((c) => (
            <code key={c} className="pill">
              {c}
            </code>
          ))}
        </div>
      ) : null}

      {panel === "scope" ? (
        <div className="stack tight" style={{ borderTop: "1px solid var(--line)", paddingTop: "var(--s3)" }}>
          <div className="field">
            <label>Capability scope</label>
            <CapabilityPicker capabilities={capabilities} selected={scope} onChange={setScope} />
          </div>
          <div className="field">
            <label>Default model (governed · model.set)</label>
            <div className="row" style={{ alignItems: "flex-end" }}>
              <input className="input grow" value={model} placeholder="e.g. qwen2.5:7b" onChange={(e) => setModel(e.target.value)} />
              <button className="btn sm" disabled={busy || !modelDirty || model.trim() === ""} onClick={() => void saveModel()}>
                {busy ? <span className="spin" /> : null} Set model
              </button>
            </div>
            <span className="hint">Admin/owner-only; must be within the Sphere-allowed set (RFC-009).</span>
          </div>
          <div className="row">
            <button
              className="btn primary sm"
              disabled={busy || !scopeDirty}
              onClick={() => void apply({ agentId: agent.id, capabilities: scope })}
            >
              {busy ? <span className="spin" /> : null} Save scope
            </button>
            <button className="btn danger sm" disabled={busy || agent.state === "disabled"} onClick={() => void apply({ agentId: agent.id, state: "disabled" })}>
              Disable agent
            </button>
          </div>
        </div>
      ) : null}

      {panel === "projection" ? (
        <div className="stack tight" style={{ borderTop: "1px solid var(--line)", paddingTop: "var(--s3)" }}>
          {projection === undefined ? (
            <span className="faint">
              <span className="spin" /> computing projection…
            </span>
          ) : "denied" in projection ? (
            <div className="note deny">Denied — {projection.denied}</div>
          ) : (
            <div className="stack tight">
              <span className="eyebrow">governed runtime projection (RFC-007)</span>
              <div className="tablewrap">
                <table className="grid-table">
                  <tbody>
                    <tr>
                      <td className="faint">provider · model</td>
                      <td>
                        <code>{projection.provider}</code> · <code>{projection.model}</code> · {projection.execution}
                      </td>
                    </tr>
                    <tr>
                      <td className="faint">sphere MCP gateway</td>
                      <td>
                        <code>{projection.gatewayEndpoint}</code>
                      </td>
                    </tr>
                    <tr>
                      <td className="faint">auth</td>
                      <td>
                        by reference · <code>{projection.authSecretRef}</code>
                      </td>
                    </tr>
                    <tr>
                      <td className="faint">allowed tools</td>
                      <td>
                        {projection.allowedTools.length === 0 ? (
                          <span className="faint">none (deny by default)</span>
                        ) : (
                          projection.allowedTools.map((t) => (
                            <code key={t} className="pill" style={{ marginRight: 4 }}>
                              {t}
                            </code>
                          ))
                        )}
                      </td>
                    </tr>
                    <tr>
                      <td className="faint">autonomous install</td>
                      <td>{projection.autonomousInstallDisabled ? "disabled" : "enabled"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {note ? <div className={`note ${note.tone}`}>{note.text}</div> : null}
    </div>
  );
}

export { isAgentFacing };
