"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { MemberSummary } from "../lib/api";

/**
 * Dev identity switcher. Sets `?actor=` so every workspace section acts as the
 * chosen member — anticipating real auth / RFC-006 impersonation. It reads the
 * active identity from the URL itself (so it works inside a layout, which cannot
 * receive searchParams), defaulting to the first parent, then any member. The
 * selected identity never bypasses policy; it only determines whose rights apply.
 */
export function DevActorSwitcher({ members }: { members: readonly MemberSummary[] }) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const search = useSearchParams();

  const selected =
    search.get("actor") ?? members.find((m) => m.role === "parent")?.id ?? members[0]?.id ?? "";
  const actor = members.find((m) => m.id === selected);

  function switchActor(memberId: string): void {
    const params = new URLSearchParams(search.toString());
    params.set("actor", memberId);
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="actor-card">
      <div className="actor-avatar">{(actor?.role ?? "?").slice(0, 1).toUpperCase()}</div>
      <div className="actor-copy">
        <span className="eyebrow">Identity active · dev</span>
        <select
          aria-label="Acting identity"
          className="actor-select"
          value={selected}
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
