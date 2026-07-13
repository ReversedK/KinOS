"use client";

import { useState } from "react";

import {
  CLIENT_API_BASE,
  ageProfileForRole,
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

const TYPE_TONE: Record<string, string> = { skill: "brand", connector: "info", agent_template: "pending" };

/**
 * Package store (RFC-002): browse the curated catalog + Install, and manage
 * installed packages (Enable/Disable). The UI only triggers the governed
 * endpoints; install never grants use (the grant wizard / policies do), and the
 * Policy Engine gates every call.
 */
export function Store({
  sphereId,
  members,
  catalog,
  installed,
}: {
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
      const res = await installStorePackage(CLIENT_API_BASE, sphereId, subject(), pkg.id);
      if (res.code === "forbidden") setNote(`Denied — ${res.message ?? "forbidden"}`);
      else if (res.status !== undefined)
        setRows((rs) => [...rs.filter((r) => r.id !== pkg.id), { id: pkg.id, type: pkg.type, title: pkg.title, description: pkg.description, status: res.status as string }]);
    } catch (e) {
      setNote(`Error — ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(id: string, enabled: boolean): Promise<void> {
    setBusy(true);
    setNote(undefined);
    try {
      const res = await setPackageEnabled(CLIENT_API_BASE, sphereId, id, enabled, subject());
      if (res.code === "forbidden") setNote(`Denied — ${res.message ?? "forbidden"}`);
      else if (res.status !== undefined) setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status: res.status as string } : r)));
    } catch (e) {
      setNote(`Error — ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack loose">
      <div className="row between">
        <div className="field" style={{ maxWidth: 220 }}>
          <label>Acting as</label>
          <select className="select" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.role}
              </option>
            ))}
          </select>
        </div>
        {note ? <div className="note deny" style={{ maxWidth: 420 }}>{note}</div> : null}
      </div>

      <div className="stack tight">
        <span className="eyebrow">curated catalog</span>
        <div className="grid cols-2">
          {catalog.map((p) => {
            const st = statusOf(p.id);
            return (
              <div key={p.id} className="card stack tight">
                <div className="row between">
                  <div className="row" style={{ gap: "var(--s2)" }}>
                    <strong>{p.title}</strong>
                    <span className={`badge ${TYPE_TONE[p.type] ?? ""}`}>{p.type}</span>
                  </div>
                  <span className="faint mono" style={{ fontSize: 12 }}>v{p.version}</span>
                </div>
                <p className="help" style={{ margin: 0 }}>{p.description}</p>
                {p.providesCapabilities.length > 0 ? (
                  <div className="row" style={{ gap: 4 }}>
                    {p.providesCapabilities.map((c) => (
                      <code key={c} className="pill">
                        {c}
                      </code>
                    ))}
                  </div>
                ) : null}
                <div className="row between">
                  <span className="faint" style={{ fontSize: 12 }}>
                    {p.publisher} · {p.ageRating}
                  </span>
                  <button
                    className={`btn sm${st === undefined ? " primary" : ""}`}
                    disabled={busy || memberId === "" || st !== undefined}
                    onClick={() => void install(p)}
                  >
                    {st !== undefined ? st : "Install"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="panel">
          <div className="panel-head">
            <h3>Installed · {rows.length}</h3>
          </div>
          <div className="panel-body flush">
            {rows.map((p) => (
              <div key={p.id} className="rowitem">
                <div className="lead">
                  <span className={`badge ${p.status === "enabled" ? "allow" : ""}`}>
                    <span className="dot" />
                    {p.status}
                  </span>
                  <strong>{p.title}</strong>
                </div>
                <button className="btn sm" disabled={busy || memberId === ""} onClick={() => void toggle(p.id, p.status !== "enabled")}>
                  {p.status === "enabled" ? "Disable" : "Enable"}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
