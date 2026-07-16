"use client";

import { useState } from "react";

import { CLIENT_API_BASE, setIntegrationEnabled, type ActingSubject, type IntegrationSummary } from "../../../lib/api";

/**
 * Connectors (integrations) view (RFC-003 / integration-model). Lists the
 * Sphere's integrations and lets an admin enable/disable each via the governed
 * endpoint. The UI only triggers; the Policy Engine decides. Secrets are never
 * shown — only the connector, its status, and the capabilities it provides.
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

  if (rows.length === 0) {
    return <div className="empty">No connectors installed. Install a connector package from the store.</div>;
  }

  return (
    <div className="stack tight">
      {rows.map((i) => (
        <div key={i.id} className="rowitem" style={{ border: "1px solid var(--line)", borderRadius: "var(--radius-sm)" }}>
          <div className="lead">
            <span className={`badge ${i.status === "enabled" ? "allow" : ""}`}>
              <span className="dot" />
              {i.status}
            </span>
            <span>
              <strong>{i.provider}</strong>
              <div className="faint" style={{ fontSize: 12 }}>{i.providesCapabilities.join(", ") || "—"}</div>
            </span>
          </div>
          <button className="btn sm" disabled={busy} onClick={() => void toggle(i.id, i.status !== "enabled")}>
            {i.status === "enabled" ? "Disable" : "Enable"}
          </button>
        </div>
      ))}
      {note ? <div className="note deny">{note}</div> : null}
    </div>
  );
}
