"use client";

import { useState } from "react";

import {
  CLIENT_API_BASE,
  beginRuntimeOAuth,
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

/** RFC-049: a codex (OpenAI coding) model — where "Sign in with ChatGPT" applies. */
const isCodexModel = (model: string): boolean => /codex/i.test(model);

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
  const [authMethod, setAuthMethod] = useState<"apikey" | "oauth">("apikey");
  const [note, setNote] = useState<{ tone: string; text: string }>();
  const [busy, setBusy] = useState(false);

  // RFC-049: the OAuth ("Sign in with ChatGPT") auth option is offered only for an
  // OpenAI codex model; otherwise the profile authenticates with an API-key reference.
  const oauthEligible = provider === "openai" && isCodexModel(model);
  const effectiveAuth: "apikey" | "oauth" = oauthEligible ? authMethod : "apikey";

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

  // RFC-049: begin "Sign in with ChatGPT" for the codex model, then follow the
  // authorize URL. The governed /oauth/connected assembles the OpenAI OAuth profile.
  async function connectChatGpt(): Promise<void> {
    setBusy(true);
    setNote(undefined);
    try {
      const res = await beginRuntimeOAuth(CLIENT_API_BASE, sphereId, actor, model.trim());
      if (res.authorizeUrl !== undefined) window.location.href = res.authorizeUrl;
      else setNote({ tone: "deny", text: `Denied — ${res.message ?? "cannot connect"}` });
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
        // For OAuth (codex) the reference points at a ChatGPT broker account (RFC-049).
        ...(secretRef.trim() !== "" ? { secretRef: secretRef.trim() } : {}),
        ...(provider === "openai" ? { authMethod: effectiveAuth } : {}),
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
            <label>{effectiveAuth === "oauth" ? "ChatGPT account reference" : "Secret reference"}</label>
            <input
              className="input"
              value={secretRef}
              onChange={(e) => setSecretRef(e.target.value)}
              placeholder={effectiveAuth === "oauth" ? "openai::broker://chatgpt/…" : "secret://openai/key"}
            />
          </div>
        ) : null}
      </div>

      {/* RFC-049: codex models may authenticate via "Sign in with ChatGPT" (OAuth). */}
      {oauthEligible ? (
        <div className="field">
          <label>Authentication</label>
          <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
            <button className={`btn sm${authMethod === "apikey" ? " primary" : ""}`} disabled={busy} onClick={() => setAuthMethod("apikey")}>
              API key (reference)
            </button>
            <button className={`btn sm${authMethod === "oauth" ? " primary" : ""}`} disabled={busy} onClick={() => setAuthMethod("oauth")}>
              OAuth · Sign in with ChatGPT
            </button>
          </div>
          {authMethod === "oauth" ? (
            <div className="stack tight" style={{ gap: 6 }}>
              <div>
                <button className="btn sm primary" disabled={busy || !cloudEnabled} onClick={() => void connectChatGpt()}>
                  {busy ? <span className="spin" /> : null} Connect ChatGPT →
                </button>
              </div>
              <span className="hint">
                Signing in connects a ChatGPT account and sets this codex model as the Sphere&apos;s inference profile. KinOS stores only a
                broker account reference, never a token. Requires cloud inference enabled{cloudEnabled ? "" : " (enable it below first)"} and the
                operator-provisioned OpenAI OAuth client (<span className="mono">OPENAI_OAUTH_*</span> in <span className="mono">.env</span>).
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
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
