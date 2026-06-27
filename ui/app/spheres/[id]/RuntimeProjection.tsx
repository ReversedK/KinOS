"use client";

import { useState } from "react";

import { getAgentRuntimeProjection, type ActingSubject, type RuntimeProjection } from "../../../lib/api";
import type { RunMember } from "./RunCapability";

function ageProfileForRole(role: string): string {
  if (role === "child") return "child";
  if (role === "teenager") return "teen";
  return "adult";
}

/**
 * Admin preview of an agent's governed runtime config projection (RFC-007/ADR-007):
 * the single Sphere MCP gateway, the deny-by-default authorized tool surface, the
 * native-tool allow-list and the install-disabled flag — the exact governed config
 * that would be written to the agent's Hermes profile. Read/compute only; the UI
 * triggers it, the Policy Engine gates it (admin-only). Secrets shown by reference.
 */
export function RuntimeProjection({
  baseUrl,
  sphereId,
  agentId,
  members,
}: {
  baseUrl: string;
  sphereId: string;
  agentId: string;
  members: readonly RunMember[];
}) {
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [proj, setProj] = useState<RuntimeProjection>();
  const [outcome, setOutcome] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function preview(): Promise<void> {
    const member = members.find((m) => m.id === memberId);
    if (member === undefined) {
      setOutcome("select a member");
      return;
    }
    setBusy(true);
    setOutcome(undefined);
    setProj(undefined);
    try {
      const subject: ActingSubject = { memberId: member.id, role: member.role, ageProfile: ageProfileForRole(member.role) };
      const res = await getAgentRuntimeProjection(baseUrl, sphereId, agentId, subject);
      if (res.code === "forbidden") {
        setOutcome(`denied: ${res.reason ?? "forbidden"}`);
      } else {
        setProj(res);
      }
    } catch (e) {
      setOutcome(`error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: "0.5rem" }}>
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
        <button type="button" disabled={busy || memberId === ""} onClick={() => void preview()}>
          Preview Hermes projection
        </button>
        {outcome !== undefined ? <span style={{ color: "#9aa0a6", fontSize: "0.85rem" }}>{outcome}</span> : null}
      </div>
      {proj !== undefined ? (
        <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "#c9ccd1" }}>
          <div>
            provider <code>{proj.provider}</code> · model <code>{proj.model}</code> · {proj.execution}
          </div>
          <div>
            gateway <code>{proj.gatewayEndpoint}</code> · token <code>{proj.authSecretRef}</code>
          </div>
          <div>
            allowed tools:{" "}
            {proj.allowedTools.length === 0 ? (
              <em>none (deny by default)</em>
            ) : (
              proj.allowedTools.map((t) => (
                <code key={t} style={{ marginRight: "0.4rem" }}>
                  {t}
                </code>
              ))
            )}
          </div>
          <div>
            native tools: {proj.nativeToolsAllow.length === 0 ? <em>none</em> : proj.nativeToolsAllow.join(", ")} · autonomous
            install {proj.autonomousInstallDisabled ? "disabled" : "ENABLED"}
          </div>
        </div>
      ) : null}
    </div>
  );
}
