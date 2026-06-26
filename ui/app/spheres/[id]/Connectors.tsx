"use client";

import { useState } from "react";

import { setIntegrationEnabled, type ActingSubject, type IntegrationSummary } from "../../../lib/api";
import type { RunMember } from "./RunCapability";

function ageProfileForRole(role: string): string {
  if (role === "child") return "child";
  if (role === "teenager") return "teen";
  return "adult";
}

/**
 * Connectors (integrations) view (RFC-003/integration-model). Lists the Sphere's
 * integrations and lets an admin enable/disable each via the governed endpoint.
 * The UI only triggers; the Policy Engine decides. Acting member chosen for the
 * dev MVP (anticipates auth/RFC-006). Secrets are never shown.
 */
export function Connectors({
  baseUrl,
  sphereId,
  members,
  integrations,
}: {
  baseUrl: string;
  sphereId: string;
  members: readonly RunMember[];
  integrations: readonly IntegrationSummary[];
}) {
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [rows, setRows] = useState<readonly IntegrationSummary[]>(integrations);
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);

  const subject = (): ActingSubject => {
    const m = members.find((x) => x.id === memberId);
    return { memberId, role: m?.role ?? "guest", ageProfile: ageProfileForRole(m?.role ?? "guest") };
  };

  async function toggle(id: string, enabled: boolean): Promise<void> {
    setBusy(true);
    setNote(undefined);
    try {
      const res = await setIntegrationEnabled(baseUrl, sphereId, id, enabled, subject());
      if (res.code === "forbidden") {
        setNote(`denied: ${res.message ?? "forbidden"}`);
      } else if (res.status !== undefined) {
        setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status: res.status as string } : r)));
      }
    } catch (e) {
      setNote(`error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0) {
    return <p style={{ color: "#9aa0a6" }}>No connectors installed.</p>;
  }

  return (
    <div>
      <label style={{ fontSize: "0.85rem" }}>
        as{" "}
        <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.role}
            </option>
          ))}
        </select>
      </label>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.5rem", marginTop: "0.5rem" }}>
        {rows.map((i) => (
          <li key={i.id} style={{ border: "1px solid #2a2d34", borderRadius: 6, padding: "0.5rem 0.75rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>
              <strong>{i.provider}</strong> <span style={{ color: "#9aa0a6" }}>· {i.status}</span>
              <div style={{ color: "#9aa0a6", fontSize: "0.8rem" }}>{i.providesCapabilities.join(", ") || "—"}</div>
            </span>
            <button
              type="button"
              disabled={busy || memberId === ""}
              onClick={() => void toggle(i.id, i.status !== "enabled")}
            >
              {i.status === "enabled" ? "Disable" : "Enable"}
            </button>
          </li>
        ))}
      </ul>
      {note !== undefined ? <p style={{ color: "#9aa0a6", fontSize: "0.85rem" }}>{note}</p> : null}
    </div>
  );
}
