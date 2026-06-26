"use client";

import { useState } from "react";

import { setRuntime, type ActingSubject } from "../../../lib/api";
import type { RunMember } from "./RunCapability";

function ageProfileForRole(role: string): string {
  if (role === "child") return "child";
  if (role === "teenager") return "teen";
  return "adult";
}

/**
 * Admin form to change the Sphere's inference provider/model (RFC-004) via the
 * governed write endpoint. The UI only triggers it; the Policy Engine decides
 * (admin-only, deny-by-default) and the core refuses disallowed providers /
 * cloud-while-disabled. Acting member is chosen for the dev MVP (anticipates
 * real auth / RFC-006 impersonation).
 */
export function SetRuntime({
  baseUrl,
  sphereId,
  members,
}: {
  baseUrl: string;
  sphereId: string;
  members: readonly RunMember[];
}) {
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [provider, setProvider] = useState("ollama");
  const [model, setModel] = useState("llama3.2");
  const [outcome, setOutcome] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
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
      const execution = provider === "openai" ? "cloud" : "local";
      const res = await setRuntime(baseUrl, sphereId, subject, { providerId: provider, model: model.trim(), execution });
      setOutcome(res.code === "forbidden" ? `denied: ${res.message ?? "forbidden"}` : `${res.status ?? "ok"}`);
    } catch (e) {
      setOutcome(`error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
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
      <select value={provider} onChange={(e) => setProvider(e.target.value)}>
        <option value="ollama">ollama (local)</option>
        <option value="openai">openai (cloud)</option>
      </select>
      <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="model" style={{ minWidth: "10rem" }} />
      <button type="button" disabled={busy || memberId === ""} onClick={() => void save()}>
        Save provider
      </button>
      {outcome !== undefined ? <span style={{ color: "#9aa0a6", fontSize: "0.85rem" }}>{outcome}</span> : null}
    </div>
  );
}
