"use client";

import { useState } from "react";

import {
  CLIENT_API_BASE,
  disableCloudInference,
  enableCloudInference,
  setRuntime,
  type ActingSubject,
} from "../../../lib/api";
import { describeOutcome } from "../../../lib/outcome";

/**
 * Change the Sphere's inference provider/model (RFC-004) via the governed write
 * endpoint. The UI only triggers it; the Policy Engine decides (admin-only,
 * deny-by-default) and the core refuses disallowed providers / cloud-while-
 * disabled. Selecting a cloud provider engages the external-transfer/consent path.
 *
 * This is the *inference* choice — which backend generates tokens — not a choice
 * of Harness. Hermes is the sole Harness (ADR-008 §3) and is never listed here:
 * the provider/model set below is projected into the agent's Hermes profile, so
 * Hermes runs on exactly what KinOS decided (ADR-008 §4).
 */
/** Where each provider is reached from inside the compose network by default. */
const DEFAULT_BASE_URL: Readonly<Record<string, string>> = {
  ollama: "http://host.docker.internal:11434",
  openai: "",
};

export function SetRuntime({
  sphereId,
  actor,
  cloudEnabled = false,
}: {
  sphereId: string;
  actor: ActingSubject;
  /** RFC-046: whether the Sphere currently permits cloud inference. */
  cloudEnabled?: boolean;
}) {
  const [provider, setProvider] = useState("ollama");
  const [model, setModel] = useState("gemma4-128k");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL["ollama"] ?? "");
  const [secretRef, setSecretRef] = useState("");
  const [note, setNote] = useState<{ tone: string; text: string }>();
  const [busy, setBusy] = useState(false);

  function selectProvider(next: string): void {
    setProvider(next);
    setBaseUrl(DEFAULT_BASE_URL[next] ?? "");
  }

  // RFC-046: enabling cloud is approval-floored; disabling is the immediate
  // safety kill-switch. Both are governed capabilities — the UI only triggers them.
  async function toggleCloud(enable: boolean): Promise<void> {
    setBusy(true);
    setNote(undefined);
    try {
      const res = enable
        ? await enableCloudInference(CLIENT_API_BASE, sphereId, actor, { allowProviders: ["openai"] })
        : await disableCloudInference(CLIENT_API_BASE, sphereId, actor);
      setNote(describeOutcome(res));
    } catch (e) {
      setNote({ tone: "deny", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<void> {
    setBusy(true);
    setNote(undefined);
    try {
      const execution = provider === "openai" ? "cloud" : "local";
      const res = await setRuntime(CLIENT_API_BASE, sphereId, actor, {
        providerId: provider,
        model: model.trim(),
        execution,
        ...(baseUrl.trim() !== "" ? { baseUrl: baseUrl.trim() } : {}),
        // Cloud credentials travel as a secret-store reference, never a key value.
        ...(secretRef.trim() !== "" ? { secretRef: secretRef.trim() } : {}),
      });
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
          <label>Inference provider</label>
          <select className="select" value={provider} onChange={(e) => selectProvider(e.target.value)}>
            <option value="ollama">ollama · local</option>
            <option value="openai">openai · cloud</option>
          </select>
        </div>
        <div className="field grow">
          <label>Model</label>
          <input className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="model tag" />
        </div>
        <button className="btn" disabled={busy} onClick={() => void save()}>
          {busy ? <span className="spin" /> : null} Save
        </button>
      </div>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field grow">
          <label>Base URL</label>
          <input
            className="input"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={provider === "ollama" ? "http://host.docker.internal:11434" : "optional · OpenAI-compatible endpoint"}
          />
        </div>
        {provider === "openai" ? (
          <div className="field grow">
            <label>Secret reference</label>
            <input
              className="input"
              value={secretRef}
              onChange={(e) => setSecretRef(e.target.value)}
              placeholder="secret://openai/key"
            />
          </div>
        ) : null}
      </div>
      {/* RFC-046: cloud is off until explicitly, governably enabled. */}
      <div className="row between" style={{ alignItems: "center", gap: "var(--s3)" }}>
        <span className="faint">
          Cloud inference {cloudEnabled ? <strong>enabled</strong> : <strong>disabled</strong>} for this Sphere
        </span>
        {cloudEnabled ? (
          <button className="btn ghost sm danger" disabled={busy} onClick={() => void toggleCloud(false)}>
            {busy ? <span className="spin" /> : null} Disable cloud
          </button>
        ) : (
          <button className="btn sm" disabled={busy} onClick={() => void toggleCloud(true)}>
            {busy ? <span className="spin" /> : null} Enable cloud inference…
          </button>
        )}
      </div>
      {provider === "openai" && !cloudEnabled ? (
        <div className="note deny">
          Cloud inference is disabled for this Sphere, so an OpenAI (cloud) profile is refused. Enable cloud inference above first — it is
          approval-gated (another administrator must release it), then set the provider with a secret reference.
        </div>
      ) : null}
      <span className="hint">
        Projected into each agent&apos;s Hermes profile, so the Harness runs on exactly this provider/model (ADR-008 §4). Re-project the
        agent&apos;s runtime config to apply it to a deployed agent.
      </span>
      {provider === "openai" ? (
        <span className="hint">Cloud inference engages the external-transfer / consent path and requires a secret reference (RFC-004).</span>
      ) : null}
      {note ? <div className={`note ${note.tone}`}>{note.text}</div> : null}
    </div>
  );
}
