"use client";

import type { CatalogCapability } from "../lib/api";
import { capabilityLabel } from "../lib/capabilityMeta";

/** Capability-name prefixes that are admin/governance surfaces, not an agent's
 * own request scope — hidden from the agent capability picker. */
const ADMIN_PREFIXES = ["sphere.", "member.", "agent.", "runtime.", "integration.", "package.", "policy.", "store."];

export function isAgentFacing(name: string): boolean {
  return !ADMIN_PREFIXES.some((p) => name.startsWith(p));
}

function riskTone(risk: string): string {
  if (risk === "critical" || risk === "high") return "deny";
  if (risk === "medium") return "pending";
  return "allow";
}

/** Group a capability into a friendly, colour-coded category for the picker. */
interface Group {
  key: string;
  title: string;
  tile: string;
  glyph: string;
}
const GROUPS: readonly Group[] = [
  { key: "calendar", title: "Calendar", tile: "calendar", glyph: "📅" },
  { key: "document", title: "Documents", tile: "docs", glyph: "📄" },
  { key: "memory", title: "Notes & memory", tile: "docs", glyph: "🗒" },
  { key: "sphere", title: "Shared workspace", tile: "agent", glyph: "◫" },
  { key: "message", title: "Messaging", tile: "message", glyph: "✉" },
  { key: "payment", title: "Payments", tile: "payment", glyph: "❖" },
  { key: "native", title: "Harness abilities", tile: "harness", glyph: "⚙" },
  { key: "other", title: "Other", tile: "store", glyph: "◈" },
];

function groupOf(name: string): string {
  const prefix = name.split(".")[0] ?? "other";
  if (name.startsWith("sphere.")) return "sphere";
  return GROUPS.some((g) => g.key === prefix) ? prefix : "other";
}

/**
 * Choose the capabilities an agent may request, GROUPED by category (RFC-008). The
 * scope is a request surface only — every call is still policy-checked per call.
 * The friendly action is primary; the dotted capability id is shown secondarily
 * (mono) for the operator. No raw tool ids are exposed.
 */
export function CapabilityPicker({
  capabilities,
  selected,
  onChange,
}: {
  capabilities: readonly CatalogCapability[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const facing = capabilities.filter((c) => isAgentFacing(c.name));
  const toggle = (name: string) =>
    onChange(selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name]);

  if (facing.length === 0) return <p className="hint">No capabilities available.</p>;

  // Only render groups that actually have capabilities, in GROUPS order.
  const grouped = GROUPS.map((g) => ({ g, caps: facing.filter((c) => groupOf(c.name) === g.key) })).filter((x) => x.caps.length > 0);

  return (
    <div className="stack tight">
      {grouped.map(({ g, caps }) => {
        const names = caps.map((c) => c.name);
        const allSel = names.every((n) => selected.includes(n));
        const someSel = !allSel && names.some((n) => selected.includes(n));
        const toggleGroup = () =>
          onChange(allSel ? selected.filter((n) => !names.includes(n)) : [...new Set([...selected, ...names])]);
        return (
          <div key={g.key} style={{ border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
            <div className="row between" style={{ padding: "10px 12px", background: "color-mix(in oklab, var(--panel-2) 40%, transparent)", borderBottom: "1px solid var(--line)" }}>
              <span className="row" style={{ gap: "var(--s2)" }}>
                <span className={`tile ${g.tile}`} style={{ width: 28, height: 28, fontSize: 14, borderRadius: 8 }}>{g.glyph}</span>
                <strong style={{ fontSize: 14 }}>{g.title}</strong>
                <span className="faint" style={{ fontSize: 12 }}>{caps.filter((c) => selected.includes(c.name)).length}/{caps.length}</span>
              </span>
              <button type="button" className="btn sm ghost" onClick={toggleGroup}>
                {allSel ? "Clear" : someSel ? "Select all" : "Select all"}
              </button>
            </div>
            <div>
              {caps.map((c) => (
                <label key={c.name} className="row" style={{ gap: "var(--s3)", alignItems: "flex-start", padding: "9px 12px", borderTop: "1px solid var(--line)", cursor: "pointer" }}>
                  <input type="checkbox" checked={selected.includes(c.name)} onChange={() => toggle(c.name)} style={{ marginTop: 3, accentColor: "var(--brand)", width: 16, height: 16, flex: "none" }} />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="row" style={{ gap: "var(--s2)" }}>
                      <strong style={{ fontSize: 13.5 }}>{capabilityLabel(c.name)}</strong>
                      <span className={`badge ${riskTone(c.risk)}`}>{c.risk}</span>
                      {c.approvalFloor ? <span className="badge pending">approval</span> : null}
                    </span>
                    <span className="faint" style={{ display: "block", fontSize: 12 }}>{c.description}</span>
                    <span className="mono faint" style={{ fontSize: 11 }}>{c.name}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
