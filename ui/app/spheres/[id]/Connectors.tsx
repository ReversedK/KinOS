"use client";

import { useState } from "react";

import {
  CLIENT_API_BASE,
  beginOAuthConnect,
  configureIntegration,
  setIntegrationEnabled,
  type ActingSubject,
  type IntegrationSummary,
} from "../../../lib/api";

/**
 * Connectors (integrations) view (RFC-003 / integration-model / RFC-016/018). Lists
 * the Sphere's integrations and lets an admin connect/configure and enable/disable
 * each via the governed endpoints. The UI only triggers; the Policy Engine decides.
 * Secrets are never shown — only the connector, its status, whether it is
 * configured, and the capabilities it provides. An OAuth integration shows a
 * Connect button (redirects to the provider); an api-key one shows a reference field.
 */
export function Connectors({
  sphereId,
  actor,
  integrations,
}: {
  sphereId: string;
  actor: ActingSubject;
  integrations: readonly IntegrationSummary[];
}) {
  const [rows, setRows] = useState<readonly IntegrationSummary[]>(integrations);
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);

  const [secretRefs, setSecretRefs] = useState<Record<string, string>>({});

  async function toggle(id: string, enabled: boolean): Promise<void> {
    setBusy(true);
    setNote(undefined);
    try {
      const res = await setIntegrationEnabled(CLIENT_API_BASE, sphereId, id, enabled, actor);
      if (res.code === "forbidden") setNote(`Denied — ${res.message ?? "forbidden"}`);
      else if (res.status !== undefined) setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status: res.status as string } : r)));
    } catch (e) {
      setNote(`Error — ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function connect(id: string): Promise<void> {
    setBusy(true);
    setNote(undefined);
    try {
      const res = await beginOAuthConnect(CLIENT_API_BASE, sphereId, id, actor);
      if (res.authorizeUrl !== undefined) {
        // Redirect the browser to the provider's consent screen; it returns to
        // /oauth/connected, which binds the account to this integration.
        window.location.href = res.authorizeUrl;
      } else {
        setNote(`Denied — ${res.message ?? "cannot connect"}`);
      }
    } catch (e) {
      setNote(`Error — ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function configure(id: string): Promise<void> {
    const ref = (secretRefs[id] ?? "").trim();
    if (ref === "") return;
    setBusy(true);
    setNote(undefined);
    try {
      const res = await configureIntegration(CLIENT_API_BASE, sphereId, id, { secretRef: ref }, actor);
      if (res.configured) setRows((rs) => rs.map((r) => (r.id === id ? { ...r, configured: true } : r)));
      else setNote(res.message ?? "Could not configure");
    } catch (e) {
      setNote(`Error — ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  // RFC-034: pick the provider that backs this integration (local / Google / …).
  // Persist the choice, then the row shows that provider's connect affordance. A
  // provider switch drops any stale credential (fresh connect required).
  async function setProvider(row: IntegrationSummary, provider: string): Promise<void> {
    if (provider === row.provider) return;
    const auth = row.providerChoices?.find((c) => c.provider === provider)?.auth ?? "none";
    setBusy(true);
    setNote(undefined);
    try {
      const res = await configureIntegration(CLIENT_API_BASE, sphereId, row.id, { provider }, actor);
      if (res.code === undefined && res.provider !== undefined) {
        setRows((rs) =>
          rs.map((r) =>
            r.id === row.id ? { ...r, provider, auth: auth === "none" ? undefined : auth, configured: false } : r,
          ),
        );
      } else {
        setNote(res.message ?? "Could not set provider");
      }
    } catch (e) {
      setNote(`Error — ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0) {
    return <div className="empty"><span className="empty-glyph">⇄</span>No connectors installed. Add one from the store to give agents a real calendar, notes, or other service.</div>;
  }

  return (
    <div className="stack tight">
      {rows.map((i) => (
        <div key={i.id} className="stack tight" style={{ border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", padding: "var(--s3)" }}>
          <div className="rowitem" style={{ border: "none", padding: 0 }}>
            <div className="lead">
              <span className={`badge ${i.status === "enabled" ? "allow" : ""}`}>
                <span className="dot" />
                {i.status}
              </span>
              <span>
                <strong>{i.provider}</strong>
                {i.configured ? <span className="faint" style={{ fontSize: 11, marginLeft: 6 }}>· connected</span> : null}
                {i.provider === "local" ? <span className="faint" style={{ fontSize: 11, marginLeft: 6 }}>· no setup needed</span> : null}
                <div className="faint" style={{ fontSize: 12 }}>{i.providesCapabilities.join(", ") || "—"}</div>
              </span>
            </div>
            <div className="row" style={{ gap: "var(--s2)" }}>
              {i.auth === "oauth" ? (
                <button className="btn sm" disabled={busy} onClick={() => void connect(i.id)}>
                  {i.configured ? "Reconnect" : `Connect ${i.provider}`}
                </button>
              ) : null}
              <button className="btn sm" disabled={busy} onClick={() => void toggle(i.id, i.status !== "enabled")}>
                {i.status === "enabled" ? "Disable" : "Enable"}
              </button>
            </div>
          </div>
          {/* RFC-034: choose which provider backs this integration (when it offers more than one). */}
          {i.providerChoices !== undefined && i.providerChoices.length > 1 ? (
            <div className="row" style={{ gap: "var(--s2)", alignItems: "center" }}>
              <label style={{ fontSize: 11 }} className="faint">Provider</label>
              <select
                className="select"
                value={i.provider}
                disabled={busy}
                onChange={(e) => void setProvider(i, e.target.value)}
              >
                {i.providerChoices.map((c) => (
                  <option key={c.provider} value={c.provider}>
                    {c.provider}{c.auth === "none" ? " (local, no setup)" : c.auth === "oauth" ? " (connect)" : " (api key)"}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {i.auth === "apikey" ? (
            <div className="row" style={{ gap: "var(--s2)", alignItems: "flex-end" }}>
              <div className="field grow">
                <label style={{ fontSize: 11 }}>Credentials reference</label>
                <input
                  className="input"
                  placeholder="secret://provider/…"
                  value={secretRefs[i.id] ?? ""}
                  onChange={(e) => setSecretRefs((s) => ({ ...s, [i.id]: e.target.value }))}
                />
              </div>
              <button className="btn sm ghost" disabled={busy} onClick={() => void configure(i.id)}>
                Save
              </button>
            </div>
          ) : null}
        </div>
      ))}
      <span className="hint">
        OAuth connectors send you to the provider to consent; KinOS stores only a reference, never a token. Api-key connectors take a
        secret-store <em>reference</em> — never paste a raw key.
      </span>
      {note ? <div className="note deny">{note}</div> : null}
    </div>
  );
}
