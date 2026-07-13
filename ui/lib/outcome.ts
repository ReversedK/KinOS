import type { ExecutionOutcome } from "./api";

export type OutcomeTone = "allow" | "deny" | "pending" | "info";

/**
 * Render a governed ExecutionOutcome as a user-safe note. The UI only reflects
 * the Policy Engine's decision (allow / require_approval / deny) or an execution
 * failure — it decides nothing (coding principle 1).
 */
export function describeOutcome(res: ExecutionOutcome): { tone: OutcomeTone; text: string } {
  if (res.code === "forbidden") {
    return { tone: "deny", text: `Denied — ${res.reason ?? res.message ?? "policy forbids this action"}` };
  }
  if (res.code === "execution_failed") {
    return { tone: "deny", text: `Failed — ${res.message ?? res.reason ?? "execution error"}` };
  }
  if (res.code !== undefined && res.status === undefined) {
    return { tone: "deny", text: `${res.code} — ${res.message ?? res.reason ?? "error"}` };
  }
  if (res.status === "pending_approval") {
    const who = res.approverRoles && res.approverRoles.length > 0 ? ` (${res.approverRoles.join(", ")})` : "";
    return { tone: "pending", text: `Approval required${who} — routed to the approvals inbox` };
  }
  if (res.status === "executed") {
    return { tone: "allow", text: "Executed" };
  }
  return { tone: "info", text: res.reason ?? res.status ?? "done" };
}
