"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { MemberSummary } from "../lib/api";

export function DevActorSwitcher({ members, actorId }: { members: readonly MemberSummary[]; actorId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  function switchActor(memberId: string): void {
    const params = new URLSearchParams(search.toString());
    params.set("actor", memberId);
    router.replace(`${pathname}?${params.toString()}`);
  }

  const actor = members.find((member) => member.id === actorId);
  return (
    <div className="actor-card">
      <div className="actor-avatar">{(actor?.role ?? "?").slice(0, 1).toUpperCase()}</div>
      <div className="actor-copy">
        <span className="eyebrow">Identity active · dev</span>
        <select
          aria-label="Acting identity"
          className="actor-select"
          value={actorId ?? ""}
          onChange={(event) => switchActor(event.target.value)}
        >
          {members.map((member) => (
            <option key={member.id} value={member.id}>{member.role} · {member.id}</option>
          ))}
        </select>
      </div>
      <span className="badge pending">impersonation</span>
    </div>
  );
}
