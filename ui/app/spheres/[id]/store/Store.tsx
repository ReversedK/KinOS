"use client";

import { useState } from "react";

import {
  installStorePackage,
  setPackageEnabled,
  type ActingSubject,
  type InstalledPackageSummary,
  type StorePackage,
} from "../../../../lib/api";

export interface StoreMember {
  readonly id: string;
  readonly role: string;
}

function ageProfileForRole(role: string): string {
  if (role === "child") return "child";
  if (role === "teenager") return "teen";
  return "adult";
}

/**
 * Package store (RFC-002): browse the curated catalog + Install, and manage
 * installed packages (Enable/Disable). The UI only triggers the governed
 * endpoints; install never grants use (the grant wizard / policies do), and the
 * Policy Engine gates every call. Acting member chosen for the dev MVP.
 */
export function Store({
  baseUrl,
  sphereId,
  members,
  catalog,
  installed,
}: {
  baseUrl: string;
  sphereId: string;
  members: readonly StoreMember[];
  catalog: readonly StorePackage[];
  installed: readonly InstalledPackageSummary[];
}) {
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [rows, setRows] = useState<readonly InstalledPackageSummary[]>(installed);
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);

  const subject = (): ActingSubject => {
    const m = members.find((x) => x.id === memberId);
    return { memberId, role: m?.role ?? "guest", ageProfile: ageProfileForRole(m?.role ?? "guest") };
  };
  const statusOf = (id: string) => rows.find((r) => r.id === id)?.status;

  async function install(pkg: StorePackage): Promise<void> {
    setBusy(true);
    setNote(undefined);
    try {
      const res = await installStorePackage(baseUrl, sphereId, subject(), pkg.id);
      if (res.code === "forbidden") setNote(`denied: ${res.message ?? "forbidden"}`);
      else if (res.status !== undefined)
        setRows((rs) => [...rs.filter((r) => r.id !== pkg.id), { id: pkg.id, type: pkg.type, title: pkg.title, description: pkg.description, status: res.status as string }]);
    } catch (e) {
      setNote(`error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(id: string, enabled: boolean): Promise<void> {
    setBusy(true);
    setNote(undefined);
    try {
      const res = await setPackageEnabled(baseUrl, sphereId, id, enabled, subject());
      if (res.code === "forbidden") setNote(`denied: ${res.message ?? "forbidden"}`);
      else if (res.status !== undefined) setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status: res.status as string } : r)));
    } catch (e) {
      setNote(`error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
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

      <h3 style={{ marginBottom: "0.5rem" }}>Store</h3>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.5rem" }}>
        {catalog.map((p) => {
          const st = statusOf(p.id);
          return (
            <li key={p.id} style={{ border: "1px solid #2a2d34", borderRadius: 6, padding: "0.5rem 0.75rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem" }}>
              <span>
                <strong>{p.title}</strong> <span style={{ color: "#9aa0a6" }}>· {p.type}</span>
                <div style={{ color: "#9aa0a6", fontSize: "0.85rem" }}>{p.description}</div>
              </span>
              <button type="button" disabled={busy || memberId === "" || st !== undefined} onClick={() => void install(p)}>
                {st !== undefined ? st : "Install"}
              </button>
            </li>
          );
        })}
      </ul>

      {rows.length > 0 ? (
        <>
          <h3 style={{ marginBottom: "0.5rem", marginTop: "1.25rem" }}>Installed</h3>
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.5rem" }}>
            {rows.map((p) => (
              <li key={p.id} style={{ border: "1px solid #2a2d34", borderRadius: 6, padding: "0.5rem 0.75rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>
                  <strong>{p.title}</strong> <span style={{ color: "#9aa0a6" }}>· {p.status}</span>
                </span>
                <button type="button" disabled={busy || memberId === ""} onClick={() => void toggle(p.id, p.status !== "enabled")}>
                  {p.status === "enabled" ? "Disable" : "Enable"}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {note !== undefined ? <p style={{ color: "#9aa0a6", fontSize: "0.85rem" }}>{note}</p> : null}
    </div>
  );
}
