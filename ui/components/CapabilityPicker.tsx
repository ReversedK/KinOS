"use client";

import type { CatalogCapability } from "../lib/api";

/** Capability-name prefixes that are admin/governance surfaces, not an agent's
 * own request scope — hidden from the agent capability picker. */
const ADMIN_PREFIXES = ["sphere.", "member.", "agent.", "runtime.", "integration.", "package."];

export function isAgentFacing(name: string): boolean {
  return !ADMIN_PREFIXES.some((p) => name.startsWith(p));
}

function riskTone(risk: string): string {
  if (risk === "critical" || risk === "high") return "deny";
  if (risk === "medium") return "pending";
  return "allow";
}

/**
 * Choose the capabilities an agent may request. The scope is a request surface
 * only — every call is still policy-checked per call (RFC-008). Capabilities are
 * the sole agent-facing surface; no raw tool ids are shown.
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
  const toggle = (name: string) => {
    onChange(selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name]);
  };

  if (facing.length === 0) {
    return <p className="hint">No capabilities available.</p>;
  }

  return (
    <div
      className="stack tight"
      style={{ maxHeight: 240, overflowY: "auto", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", padding: "var(--s2) var(--s3)" }}
    >
      {facing.map((c) => (
        <label key={c.name} className="checkline" style={{ alignItems: "flex-start" }}>
          <input type="checkbox" checked={selected.includes(c.name)} onChange={() => toggle(c.name)} style={{ marginTop: 2 }} />
          <span className="grow">
            <span className="row" style={{ gap: "var(--s2)" }}>
              <code>{c.name}</code>
              <span className={`badge ${riskTone(c.risk)}`}>{c.risk}</span>
              {c.approvalFloor ? <span className="badge pending">approval</span> : null}
            </span>
            <span className="faint" style={{ display: "block", fontFamily: "var(--font-sans)", fontSize: 12 }}>
              {c.description}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}
