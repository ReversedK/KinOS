"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { CLIENT_API_BASE, setSphereArchived, type ActingSubject } from "../lib/api";
import { describeOutcome } from "../lib/outcome";

/**
 * Archive or restore a Sphere (RFC-024). Only triggers the governed capability; the
 * Policy Engine decides. Archive is reversible and destroys nothing — it retires the
 * Sphere from the list. Archiving sends you back to the Spheres list (it is now
 * hidden there); restoring returns it to active in place.
 */
export function ArchiveSphere({ sphereId, admin, status }: { sphereId: string; admin: ActingSubject; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: string; text: string }>();
  const archived = status === "archived";

  async function act(): Promise<void> {
    setBusy(true);
    setNote(undefined);
    try {
      const res = await setSphereArchived(CLIENT_API_BASE, sphereId, admin, !archived);
      if (res.status === "executed") {
        if (archived) {
          router.refresh();
        } else {
          router.push("/"); // retired — it is now hidden from the list
        }
      } else {
        setNote(describeOutcome(res));
      }
    } catch (e) {
      setNote({ tone: "deny", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack tight">
      <p className="section-intro">
        {archived
          ? "This Sphere is archived — hidden from the Spheres list. Restoring returns it to active; nothing was lost."
          : "Archiving retires this Sphere from the list. It is reversible and destroys no data or audit — restore it any time from the Spheres list (show archived)."}
      </p>
      <div className="row" style={{ gap: "var(--s2)", alignItems: "center" }}>
        <button className={`btn sm ${archived ? "primary" : ""}`} disabled={busy} onClick={() => void act()}>
          {busy ? <span className="spin" /> : null} {archived ? "Restore Sphere" : "Archive Sphere"}
        </button>
        {archived ? <span className="badge">archived</span> : null}
      </div>
      {note ? <div className={`note ${note.tone}`}>{note.text}</div> : null}
    </div>
  );
}
