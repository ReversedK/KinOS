"use client";

import { useState } from "react";

import {
  CLIENT_API_BASE,
  ageProfileForRole,
  setPackageEnabled,
  type ActingSubject,
  type InstalledPackageSummary,
  type StorePackage,
} from "../../../../lib/api";
import { PackageWizard } from "../../../../components/PackageWizard";

export interface StoreMember {
  readonly id: string;
  readonly role: string;
}

const TYPE_TONE: Record<string, string> = { skill: "brand", connector: "info", agent_template: "pending" };

/** A category accent tile + glyph for a package, so the catalog is scannable. */
function packageTile(p: StorePackage): { tile: string; glyph: string } {
  const caps = p.providesCapabilities ?? [];
  const has = (x: string) => caps.some((c) => c.startsWith(x));
  if (has("calendar.")) return { tile: "calendar", glyph: "📅" };
  if (has("document.") || has("memory.") || /notes|workspace|documents/.test(p.id)) return { tile: "docs", glyph: "📄" };
  if (has("message.")) return { tile: "message", glyph: "✉" };
  if (has("payment.")) return { tile: "payment", glyph: "❖" };
  if (has("native.") || p.id.startsWith("hermes")) return { tile: "harness", glyph: "⚙" };
  if (p.id.includes("minecraft")) return { tile: "store", glyph: "⛏" };
  return { tile: "store", glyph: "◫" };
}

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
  const [wizardFor, setWizardFor] = useState<string>();

  const subject = (): ActingSubject => {
    const m = members.find((x) => x.id === memberId);
    return { memberId, role: m?.role ?? "guest", ageProfile: ageProfileForRole(m?.role ?? "guest") };
  };
  const statusOf = (id: string) => rows.find((r) => r.id === id)?.status;

  function recordStatus(pkg: StorePackage, status: string): void {
    setRows((rs) => [...rs.filter((r) => r.id !== pkg.id), { id: pkg.id, type: pkg.type, title: pkg.title, description: pkg.description, status }]);
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

      {/* Guided setup for the selected package (install → grant → enable → connect). */}
      {wizardFor !== undefined && memberId !== "" ? (
        (() => {
          const pkg = catalog.find((p) => p.id === wizardFor);
          if (pkg === undefined) return null;
          return (
            <PackageWizard
              sphereId={sphereId}
              subject={subject()}
              pkg={pkg}
              installedStatus={statusOf(pkg.id)}
              onClose={() => setWizardFor(undefined)}
              onStatus={(st) => recordStatus(pkg, st)}
            />
          );
        })()
      ) : null}

      <div className="stack tight">
        <span className="eyebrow">Curated catalog</span>
        <div className="grid cols-2">
          {catalog.map((p) => {
            const st = statusOf(p.id);
            const t = packageTile(p);
            return (
              <div key={p.id} className="card stack tight reveal">
                <div className="row" style={{ gap: "var(--s3)", alignItems: "flex-start", flexWrap: "nowrap" }}>
                  <span className={`tile ${t.tile}`}>{t.glyph}</span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row between" style={{ gap: "var(--s2)" }}>
                      <strong style={{ fontSize: 16 }}>{p.title}</strong>
                      <span className="pill mono" style={{ flex: "none" }}>v{p.version}</span>
                    </div>
                    <p className="help" style={{ margin: "2px 0 0", fontSize: 14 }}>{p.description}</p>
                  </div>
                </div>
                {p.providesCapabilities.length > 0 ? (
                  <div className="row" style={{ gap: 5 }}>
                    {p.providesCapabilities.map((c) => (
                      <span key={c} className="pill mono">{c}</span>
                    ))}
                  </div>
                ) : null}
                <hr className="hairline" style={{ margin: "2px 0" }} />
                <div className="row between">
                  <span className="row" style={{ gap: "var(--s2)" }}>
                    <span className={`badge ${TYPE_TONE[p.type] ?? ""}`}>{p.type}</span>
                    <span className="faint" style={{ fontSize: 12.5 }}>{p.publisher} · {p.ageRating}</span>
                  </span>
                  {st !== undefined ? (
                    <span className="row" style={{ gap: "var(--s2)" }}>
                      <span className={`badge ${st === "enabled" ? "allow" : "info"}`}><span className="dot" />{st}</span>
                      <button className="btn sm ghost" disabled={memberId === ""} onClick={() => setWizardFor(p.id)}>Set up</button>
                    </span>
                  ) : (
                    <button className="btn sm primary" disabled={busy || memberId === ""} onClick={() => setWizardFor(p.id)}>Set up →</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="panel">
          <div className="panel-head">
            <h3>Installed in this Sphere · {rows.length}</h3>
          </div>
          <div className="panel-body flush">
            {rows.map((p) => (
              <div key={p.id} className="rowitem">
                <div className="lead">
                  <span className={`badge ${p.status === "enabled" ? "allow" : "info"}`}>
                    <span className="dot" />
                    {p.status}
                  </span>
                  <strong>{p.title}</strong>
                </div>
                <button className={`btn sm${p.status === "enabled" ? "" : " primary"}`} disabled={busy || memberId === ""} onClick={() => void toggle(p.id, p.status !== "enabled")}>
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
