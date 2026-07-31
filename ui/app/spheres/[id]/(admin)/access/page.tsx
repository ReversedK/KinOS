import { ApprovalActions } from "../../../../approvals/ApprovalActions";
import { RunCapability } from "../../RunCapability";
import { apiBaseUrl, getCapabilities, getMembers, getPendingApprovals } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

/**
 * Access — the human-in-the-loop decisions and a bench to test a capability. The
 * permission RULES live in their own Policy Engine section; this screen shows the
 * actions the engine routed for a human decision and lets an operator exercise a
 * capability against them. Granting/denying is governed (quorum, minor-safety, no
 * self-approval); this screen only triggers and shows no private payload (§18).
 */
export default async function AccessSection({ params }: { params: { id: string } }) {
  const base = apiBaseUrl();
  const id = params.id;
  const [members, capabilities, pendingApprovals] = await Promise.all([
    getMembers(base, id).catch(() => []),
    getCapabilities(base).catch(() => []),
    getPendingApprovals(base, id).catch(() => []),
  ]);
  const runMembers = members.map((m) => ({ id: m.id, role: m.role }));

  return (
    <>
      {/* Approvals — pending human decisions (RFC-003). */}
      <div className="panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Human-in-the-loop</span>
            <h3>Approvals · {pendingApprovals.length}</h3>
          </div>
          <a className="btn sm ghost" href="/approvals">All spheres →</a>
        </div>
        <div className="panel-body">
          {pendingApprovals.length === 0 ? (
            <div className="empty">
              <span className="empty-glyph">✓</span>
              Nothing awaiting approval. Approval-gated actions (e.g. proposing a calendar event) appear here for an approver to decide.
            </div>
          ) : (
            <div className="stack">
              {pendingApprovals.map((p) => {
                const eligible = members
                  .filter((m) => p.approverRoles.includes(m.role))
                  .map((m) => ({ memberId: m.id, role: m.role }));
                return (
                  <div key={p.id} className="card stack tight">
                    <div className="row between">
                      <code style={{ fontSize: 14, fontWeight: 600 }}>{p.capability}</code>
                      <span className="row" style={{ gap: "var(--s2)" }}>
                        {p.risk ? <span className={`badge ${p.risk === "critical" || p.risk === "high" ? "deny" : ""}`}>{p.risk} risk</span> : null}
                        <span className="badge pending"><span className="dot" />{p.state}</span>
                      </span>
                    </div>
                    {p.summary ? <div style={{ fontSize: 13 }}>{p.summary}</div> : null}
                    <div className="row" style={{ gap: "var(--s4)", flexWrap: "wrap" }}>
                      {p.requestedByAgent ? (
                        <span className="faint" style={{ fontSize: 12 }}>
                          requested by <code>{p.requestedByAgent}</code>
                          {p.onBehalfOf ? <> · on behalf of <code>{p.onBehalfOf}</code></> : null}
                        </span>
                      ) : null}
                      {p.expiresAt ? (
                        <span className="faint" style={{ fontSize: 12 }}>expires <time dateTime={p.expiresAt}>{p.expiresAt.slice(0, 16).replace("T", " ")}</time></span>
                      ) : null}
                    </div>
                    {eligible.length === 0 ? (
                      <span className="faint" style={{ fontSize: 12 }}>
                        No eligible approver in this Sphere ({p.approverRoles.join(", ")}).
                      </span>
                    ) : (
                      <ApprovalActions approvalId={p.id} approvers={eligible} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Test bench — exercise a capability against the Policy Engine's rules. */}
      <div className="panel">
        <div className="panel-head">
          <h3>Run a capability</h3>
          <span className="faint" style={{ fontSize: 12 }}>governed — allow / approval / deny</span>
        </div>
        <div className="panel-body">
          <RunCapability sphereId={id} members={runMembers} capabilities={capabilities} />
        </div>
      </div>
    </>
  );
}
