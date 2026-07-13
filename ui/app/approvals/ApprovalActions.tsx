"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { CLIENT_API_BASE, denyApproval, grantApproval, type ApproverRef } from "../../lib/api";

/**
 * Grant/deny buttons for a pending approval (RFC-003). Only *triggers* the
 * governed write endpoints — the Policy Engine and core approval rules decide
 * (eligibility, minor-safety, quorum, no self-approval). Renders the outcome; it
 * decides nothing (coding principle 1). The approver identity is a dev
 * placeholder until real auth / impersonation lands (RFC-003 / RFC-006).
 */
export function ApprovalActions({ approvalId }: { approvalId: string }) {
  const router = useRouter();
  const [note, setNote] = useState<{ tone: string; text: string }>();
  const [busy, setBusy] = useState(false);

  const approver: ApproverRef = { memberId: "ui-approver", role: "parent" };

  async function act(decision: "grant" | "deny"): Promise<void> {
    setBusy(true);
    setNote(undefined);
    try {
      const fn = decision === "grant" ? grantApproval : denyApproval;
      const res = await fn(CLIENT_API_BASE, approvalId, approver);
      const tone = res.status === "executed" ? "allow" : res.status === "denied" ? "deny" : "info";
      setNote({ tone, text: `${decision === "grant" ? "Granted" : "Denied"} → ${res.status}` });
      router.refresh();
    } catch (e) {
      setNote({ tone: "deny", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row" style={{ gap: "var(--s2)" }}>
      <button className="btn primary sm" disabled={busy} onClick={() => void act("grant")}>
        Grant
      </button>
      <button className="btn danger sm" disabled={busy} onClick={() => void act("deny")}>
        Deny
      </button>
      {note ? <span className={`badge ${note.tone}`}>{note.text}</span> : null}
    </div>
  );
}
