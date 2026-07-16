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
export function ApprovalActions({
  approvalId,
  approvers,
}: {
  approvalId: string;
  approvers: readonly ApproverRef[];
}) {
  const router = useRouter();
  const [note, setNote] = useState<{ tone: string; text: string }>();
  const [busy, setBusy] = useState(false);

  const [memberId, setMemberId] = useState(approvers[0]?.memberId ?? "");

  async function act(decision: "grant" | "deny"): Promise<void> {
    setBusy(true);
    setNote(undefined);
    try {
      const approver = approvers.find((candidate) => candidate.memberId === memberId);
      if (approver === undefined) throw new Error("Select an eligible approver");
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
      <select className="select" aria-label="Approver identity" style={{ width: "auto" }} value={memberId} onChange={(event) => setMemberId(event.target.value)}>
        {approvers.map((approver) => <option key={approver.memberId} value={approver.memberId}>{approver.role} · {approver.memberId}</option>)}
      </select>
      <button className="btn primary sm" disabled={busy || memberId === ""} onClick={() => void act("grant")}>
        Grant
      </button>
      <button className="btn danger sm" disabled={busy || memberId === ""} onClick={() => void act("deny")}>
        Deny
      </button>
      {note ? <span className={`badge ${note.tone}`}>{note.text}</span> : null}
    </div>
  );
}
