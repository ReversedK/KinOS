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
/**
 * A granted `sphere.export` returns the snapshot as the action's output (RFC-021):
 * an approval-gated payload is delivered to the approver who releases it, never to
 * the requester alone. Hand it straight to the browser as a download — it is never
 * rendered, stored, or logged here.
 */
function deliverExportIfPresent(output: unknown): boolean {
  const snapshot = output as { format?: unknown; sphere?: { id?: string } } | undefined;
  if (typeof snapshot !== "object" || snapshot === null || snapshot.format !== "kinos.sphere.export") return false;
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `kinos-sphere-${snapshot.sphere?.id ?? "export"}.json`;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}

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
      const delivered = deliverExportIfPresent(res.output);
      setNote({
        tone,
        text: `${decision === "grant" ? "Granted" : "Denied"} → ${res.status}${delivered ? " · snapshot downloaded" : ""}`,
      });
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
