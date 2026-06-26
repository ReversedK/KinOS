"use client";

import { useState } from "react";

import { executeCapability, type ActingSubject } from "../../../lib/api";

/** Map a Sphere role to its age profile (mirrors the core's ageProfileForRole). */
function ageProfileForRole(role: string): string {
  if (role === "child") return "child";
  if (role === "teenager") return "teen";
  return "adult";
}

export interface RunMember {
  readonly id: string;
  readonly role: string;
}

/**
 * Dev affordance to request a governed capability execution as a chosen member
 * (RFC-003; the member selector anticipates RFC-006 impersonation). It only
 * triggers the governed endpoint and shows the outcome (executed / pending
 * approval / denied) — the Policy Engine decides, not the UI (coding principle 1).
 */
export function RunCapability({
  baseUrl,
  sphereId,
  members,
}: {
  baseUrl: string;
  sphereId: string;
  members: readonly RunMember[];
}) {
  const [capability, setCapability] = useState("calendar.create_event");
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [outcome, setOutcome] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function run(): Promise<void> {
    const member = members.find((m) => m.id === memberId);
    if (member === undefined) {
      setOutcome("select a member");
      return;
    }
    setBusy(true);
    setOutcome(undefined);
    try {
      const subject: ActingSubject = {
        memberId: member.id,
        role: member.role,
        ageProfile: ageProfileForRole(member.role),
      };
      const res = await executeCapability(baseUrl, sphereId, capability.trim(), subject);
      setOutcome(res.code === "forbidden" ? `denied: ${res.reason ?? "forbidden"}` : `${res.status ?? "ok"}`);
    } catch (e) {
      setOutcome(`error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
      <label>
        as{" "}
        <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.role} ({m.id})
            </option>
          ))}
        </select>
      </label>
      <input
        value={capability}
        onChange={(e) => setCapability(e.target.value)}
        placeholder="capability (e.g. calendar.create_event)"
        style={{ minWidth: "16rem" }}
      />
      <button type="button" disabled={busy || memberId === ""} onClick={() => void run()}>
        Run
      </button>
      {outcome !== undefined ? (
        <span style={{ color: "#9aa0a6", fontSize: "0.85rem" }}>{outcome}</span>
      ) : null}
    </div>
  );
}
