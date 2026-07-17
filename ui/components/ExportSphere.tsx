"use client";

import { useState } from "react";

import { CLIENT_API_BASE, requestSphereExport, type ActingSubject } from "../lib/api";

/**
 * Export the Sphere for backup/restore (RFC-021, results-contract §17/§19).
 *
 * Only *triggers* the governed capability; the Policy Engine decides. The export
 * is always approval-floored, so this button never returns the snapshot: a second
 * adult must grant it in the Approvals panel, and the payload is delivered there,
 * to the approver who releases it. That is the point — the snapshot contains every
 * member's memory, so no single administrator can take it alone.
 */
export function ExportSphere({ sphereId, admin }: { sphereId: string; admin: ActingSubject }) {
  const [note, setNote] = useState<{ tone: string; text: string }>();
  const [busy, setBusy] = useState(false);

  async function requestExport(): Promise<void> {
    setBusy(true);
    setNote(undefined);
    try {
      const res = await requestSphereExport(CLIENT_API_BASE, sphereId, admin);
      if (res.status === "pending_approval") {
        setNote({ tone: "pending", text: "Sent for approval — another adult must grant it, and the file is delivered to them." });
      } else if (res.status === "executed") {
        // Only reachable if a deployment removes the approval floor.
        setNote({ tone: "allow", text: "Export authorized." });
      } else {
        setNote({ tone: "deny", text: res.message ?? res.reason ?? "Denied" });
      }
    } catch (e) {
      setNote({ tone: "deny", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row" style={{ gap: "var(--s2)" }}>
      <button className="btn sm" disabled={busy} onClick={() => void requestExport()}>
        Export Sphere
      </button>
      {note ? <span className={`badge ${note.tone}`}>{note.text}</span> : null}
    </div>
  );
}
