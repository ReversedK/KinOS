import { apiBaseUrl, getMembers, getPendingApprovals, type ApproverRef } from "../../lib/api";
import { capabilityCategory, capabilityLabel } from "../../lib/capabilityMeta";
import { ApprovalActions } from "./ApprovalActions";

export const dynamic = "force-dynamic";

// Read-only pending approvals: a supervisor sees what awaits a human decision —
// capability, Sphere, eligible approver roles — never the action's private
// payload (§18, privacy-model audit minimality).
export default async function ApprovalsPage() {
  const base = apiBaseUrl();
  let pending: Awaited<ReturnType<typeof getPendingApprovals>> = [];
  let approversBySphere = new Map<string, readonly ApproverRef[]>();
  let error: string | undefined;
  try {
    pending = await getPendingApprovals(base);
    const sphereIds = [...new Set(pending.map((item) => item.sphereId))];
    approversBySphere = new Map(await Promise.all(sphereIds.map(async (sphereId) => {
      const members = await getMembers(base, sphereId);
      const eligibleRoles = new Set(pending.filter((item) => item.sphereId === sphereId).flatMap((item) => item.approverRoles));
      return [sphereId, members.filter((member) => eligibleRoles.has(member.role)).map((member) => ({ memberId: member.id, role: member.role }))] as const;
    })));
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <div className="container narrow">
      <div className="crumbs">
        <a href="/">spheres</a> / approvals
      </div>
      <div className="stack loose">
        <div className="stack tight">
          <span className="eyebrow">human-in-the-loop</span>
          <h1 className="title">Approvals inbox</h1>
          <p className="help">
            Sensitive actions the Policy Engine routed for a human decision. Granting or denying is governed — quorum, minor-safety
            and no-self-approval are enforced by the core, not this screen.
          </p>
        </div>

        {error !== undefined ? (
          <div className="note deny">Could not load approvals — {error}</div>
        ) : pending.length === 0 ? (
          <div className="empty">
            Nothing awaiting approval.
            <div className="faint" style={{ marginTop: 8 }}>
              Approval-gated actions (e.g. <span className="mono">payment.execute</span>) will appear here.
            </div>
          </div>
        ) : (
          <div className="stack">
            {pending.map((p) => (
              <div key={p.id} className="panel reveal">
                <div className="panel-body stack tight">
                  <div className="row between" style={{ flexWrap: "nowrap", gap: "var(--s3)" }}>
                    <div className="row" style={{ gap: "var(--s3)", minWidth: 0 }}>
                      <span className={`tile ${capabilityCategory(p.capability).tile}`}>{capabilityCategory(p.capability).glyph}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 16 }}>{capabilityLabel(p.capability)}</div>
                        <code className="faint" style={{ fontSize: 12 }}>{p.capability}</code>
                      </div>
                    </div>
                    <span className="row" style={{ gap: "var(--s2)", flex: "none" }}>
                      {p.risk ? <span className={`badge ${p.risk === "critical" || p.risk === "high" ? "deny" : ""}`}>{p.risk} risk</span> : null}
                      <span className="badge pending">
                        <span className="dot" />
                        {p.state}
                      </span>
                    </span>
                  </div>
                  {/* User-safe description of the requested action (never private payload, §18). */}
                  {p.summary ? <div style={{ fontSize: 14 }} className="subtle">{p.summary}</div> : null}
                  <div className="row" style={{ gap: "var(--s4)", flexWrap: "wrap" }}>
                    <span className="faint">
                      sphere <code>{p.sphereId}</code>
                    </span>
                    {p.requestedByAgent ? (
                      <span className="faint">
                        requested by <code>{p.requestedByAgent}</code>
                        {p.onBehalfOf ? <> · on behalf of <code>{p.onBehalfOf}</code></> : null}
                      </span>
                    ) : null}
                    <span className="faint">
                      approvers {p.approverRoles.map((r) => (
                        <span key={r} className="pill" style={{ marginLeft: 4 }}>
                          {r}
                        </span>
                      ))}
                    </span>
                    {p.expiresAt ? (
                      <span className="faint">
                        expires <time dateTime={p.expiresAt}>{p.expiresAt.slice(0, 16).replace("T", " ")}</time>
                      </span>
                    ) : null}
                    <span className="faint">
                      <code>{p.id}</code>
                    </span>
                  </div>
                  <ApprovalActions
                    approvalId={p.id}
                    approvers={(approversBySphere.get(p.sphereId) ?? []).filter((approver) => p.approverRoles.includes(approver.role ?? ""))}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
