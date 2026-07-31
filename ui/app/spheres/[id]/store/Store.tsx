"use client";

import { useState, type ReactNode } from "react";

import {
  CLIENT_API_BASE,
  ageProfileForRole,
  installStorePackage,
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
  return { tile: "store", glyph: "◫" };
}

/**
 * A package "has a wizard" — and so shows a "Set up" button opening the guided
 * flow in a modal — when it is an integration/connector (an `mcp` package): those
 * need a Connect step to an external account, which is a genuine multi-step setup.
 * Plain skill packages have nothing to connect, so they get a one-click "Activate"
 * that installs + enables them with the safe adults-only preset. Widening audience
 * or approval for a skill stays a later, explicit action.
 */
function hasWizard(p: StorePackage): boolean {
  return p.type === "mcp";
}

/** Harness-native toolsets are grouped into their own section so the main catalog stays about features. */
function isHarness(p: StorePackage): boolean {
  return p.id.startsWith("hermes") || (p.providesCapabilities ?? []).some((c) => c.startsWith("native."));
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

  /** One-click Activate for a skill package: install (if needed) then enable with the safe preset. */
  async function activate(pkg: StorePackage): Promise<void> {
    setBusy(true);
    setNote(undefined);
    try {
      const sub = subject();
      let st = statusOf(pkg.id);
      if (st === undefined) {
        const ins = await installStorePackage(CLIENT_API_BASE, sphereId, sub, pkg.id);
        if (ins.code === "forbidden") {
          setNote(`Denied — ${ins.message ?? "forbidden"}`);
          return;
        }
        st = ins.status;
        recordStatus(pkg, ins.status ?? "installed");
      }
      if (st !== "enabled") {
        const res = await setPackageEnabled(CLIENT_API_BASE, sphereId, pkg.id, true, sub);
        if (res.code === "forbidden") setNote(`Denied — ${res.message ?? "forbidden"}`);
        else if (res.status !== undefined) recordStatus(pkg, res.status);
      }
    } catch (e) {
      setNote(`Error — ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  /** Footer action for a card: "Set up" (modal wizard) for connectors, else "Activate"/"Disable". */
  function cardAction(p: StorePackage): ReactNode {
    const st = statusOf(p.id);
    if (hasWizard(p)) {
      return st === undefined ? (
        <button className="btn sm primary" disabled={busy || memberId === ""} onClick={() => setWizardFor(p.id)}>
          Set up →
        </button>
      ) : (
        <button className="btn sm ghost" disabled={memberId === ""} onClick={() => setWizardFor(p.id)}>
          Set up
        </button>
      );
    }
    // Skill package: one-click activate, or disable once enabled.
    return st === "enabled" ? (
      <button className="btn sm" disabled={busy || memberId === ""} onClick={() => void toggle(p.id, false)}>
        Disable
      </button>
    ) : (
      <button className="btn sm primary" disabled={busy || memberId === ""} onClick={() => void activate(p)}>
        Activate
      </button>
    );
  }

  function card(p: StorePackage): ReactNode {
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
          <span className="row" style={{ gap: "var(--s2)" }}>
            {st !== undefined ? (
              <span className={`badge ${st === "enabled" ? "allow" : "info"}`}><span className="dot" />{st}</span>
            ) : null}
            {cardAction(p)}
          </span>
        </div>
      </div>
    );
  }

  const mainPkgs = catalog.filter((p) => !isHarness(p));
  const harnessPkgs = catalog.filter(isHarness);
  const wizardPkg = wizardFor !== undefined ? catalog.find((p) => p.id === wizardFor) : undefined;

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
        <span className="eyebrow">Curated catalog</span>
        <div className="grid cols-2">{mainPkgs.map(card)}</div>
      </div>

      {harnessPkgs.length > 0 ? (
        <div className="stack tight">
          <span className="eyebrow">Harness capabilities</span>
          <p className="help" style={{ margin: 0, fontSize: 13 }}>
            Govern the agent runtime's own built-in tools. Each grants one native toolset — nothing is re-implemented in KinOS.
          </p>
          <div className="grid cols-2">{harnessPkgs.map(card)}</div>
        </div>
      ) : null}

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

      {/* Guided setup for a connector package, in a modal (install → grant → enable → connect). */}
      {wizardPkg !== undefined && memberId !== "" ? (
        <div className="modal-backdrop" onClick={() => setWizardFor(undefined)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <PackageWizard
              sphereId={sphereId}
              subject={subject()}
              pkg={wizardPkg}
              installedStatus={statusOf(wizardPkg.id)}
              onClose={() => setWizardFor(undefined)}
              onStatus={(st) => recordStatus(wizardPkg, st)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
