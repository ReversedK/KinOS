"use client";

import { useState } from "react";

import { denyApproval, grantApproval, type ApproverRef } from "../../lib/api";

/**
 * Grant/deny buttons for a pending approval (RFC-003). A client component that
 * only *triggers* the governed write endpoints — the Policy Engine and the core
 * approval rules decide (eligibility, minor-safety, quorum). It renders the
 * returned outcome; it never decides authorization itself (coding principle 1).
 *
 * The approver identity is a dev placeholder until real authentication /
 * impersonation wiring lands (RFC-003 / RFC-006).
 */
export function ApprovalActions({ baseUrl, approvalId }: { baseUrl: string; approvalId: string }) {
  const [outcome, setOutcome] = useState<string>();
  const [busy, setBusy] = useState(false);

  const approver: ApproverRef = { memberId: "ui-approver", role: "parent" };

  async function act(decision: "grant" | "deny"): Promise<void> {
    setBusy(true);
    setOutcome(undefined);
    try {
      const fn = decision === "grant" ? grantApproval : denyApproval;
      const res = await fn(baseUrl, approvalId, approver);
      setOutcome(`${decision}ed → ${res.status}`);
    } catch (e) {
      setOutcome(`error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
      <button type="button" disabled={busy} onClick={() => void act("grant")}>
        Grant
      </button>
      <button type="button" disabled={busy} onClick={() => void act("deny")}>
        Deny
      </button>
      {outcome !== undefined ? (
        <span style={{ color: "#9aa0a6", fontSize: "0.85rem" }}>{outcome}</span>
      ) : null}
    </div>
  );
}
