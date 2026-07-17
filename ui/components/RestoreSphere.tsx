"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { CLIENT_API_BASE, restoreSphere, type ActingSubject } from "../lib/api";

/**
 * Restore a Sphere from an export file (RFC-022) — the other half of portability.
 *
 * Only *triggers* the governed capability; the Policy Engine decides. The file is
 * read in the browser and posted as the snapshot; the API validates it and refuses
 * a malformed payload or a Sphere id that already exists (restore never
 * overwrites). The restored Sphere keeps its own administrators and policies, so
 * importing a Sphere does not make the importer its admin.
 */
export function RestoreSphere({ operator }: { operator: ActingSubject }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<{ tone: string; text: string }>();
  const [busy, setBusy] = useState(false);

  async function onFile(file: File): Promise<void> {
    setBusy(true);
    setNote(undefined);
    try {
      let snapshot: unknown;
      try {
        snapshot = JSON.parse(await file.text());
      } catch {
        setNote({ tone: "deny", text: "That file is not valid JSON." });
        return;
      }
      const res = await restoreSphere(CLIENT_API_BASE, operator, snapshot);
      const restoredId = res.output?.sphereId;
      if (restoredId !== undefined) {
        setNote({ tone: "allow", text: `Restored ${res.output?.name ?? restoredId} (${res.output?.members ?? 0} members).` });
        router.refresh();
      } else if (res.code === "conflict") {
        setNote({ tone: "deny", text: "That Sphere already exists here — restore never overwrites an existing Sphere." });
      } else {
        setNote({ tone: "deny", text: res.message ?? "Could not restore that snapshot." });
      }
    } catch (e) {
      setNote({ tone: "deny", text: (e as Error).message });
    } finally {
      setBusy(false);
      if (fileRef.current !== null) fileRef.current.value = "";
    }
  }

  return (
    <div className="row" style={{ gap: "var(--s2)", alignItems: "center" }}>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file !== undefined) void onFile(file);
        }}
      />
      <button className="btn sm" disabled={busy} onClick={() => fileRef.current?.click()}>
        Restore from file
      </button>
      {note ? <span className={`badge ${note.tone}`}>{note.text}</span> : null}
    </div>
  );
}
