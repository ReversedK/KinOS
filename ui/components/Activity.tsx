import type { AuditEvent } from "../lib/api";

/**
 * Sphere activity — the governance chain made visible (RFC-020, event-model
 * §Correlation chaining).
 *
 * Events sharing one correlationId are one sensitive action, so they are grouped:
 * an auditor reads "who asked, which policy version decided, whether approval was
 * required and by whom it was answered, what executed" as a single story rather
 * than loose rows.
 *
 * These are security facts only. Audit minimality is guaranteed where events are
 * recorded, not filtered here — the record carries no conversation text, memory
 * content, credentials or tokens, so this view cannot leak them.
 */

function toneFor(decision: string | undefined): string {
  if (decision === "deny" || decision === "failed") return "deny";
  if (decision === "allow" || decision === "executed") return "allow";
  if (decision === "require_approval") return "pending";
  return "";
}

/** Group into chains, preserving the newest-first order of each chain's latest event. */
function chainsOf(events: readonly AuditEvent[]): Array<{ correlationId: string; events: AuditEvent[] }> {
  const byCorrelation = new Map<string, AuditEvent[]>();
  for (const event of events) {
    const existing = byCorrelation.get(event.correlationId);
    if (existing === undefined) byCorrelation.set(event.correlationId, [event]);
    else existing.push(event);
  }
  // Within a chain, read oldest → newest (the action's actual order); the API
  // returns newest first, so reverse each group's copy.
  return [...byCorrelation.entries()].map(([correlationId, group]) => ({
    correlationId,
    events: [...group].reverse(),
  }));
}

export function Activity({ events }: { events: readonly AuditEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="empty">
        No recorded activity yet. Every governed action — allowed, denied, or sent for approval — appears here as a security fact.
      </div>
    );
  }

  const chains = chainsOf(events);

  return (
    <div className="stack tight">
      {chains.map((chain) => (
        <div key={chain.correlationId} className="card stack tight">
          <div className="row between">
            <span className="faint" style={{ fontSize: 12 }}>
              correlation <code>{chain.correlationId}</code>
            </span>
            <span className="faint" style={{ fontSize: 12 }}>
              <time dateTime={chain.events[chain.events.length - 1]?.createdAt}>
                {(chain.events[chain.events.length - 1]?.createdAt ?? "").slice(0, 19).replace("T", " ")}
              </time>
            </span>
          </div>
          <div className="tablewrap">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>event</th>
                  <th>decision</th>
                  <th>subject</th>
                  <th>resource</th>
                  <th>policy</th>
                </tr>
              </thead>
              <tbody>
                {chain.events.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <code>{e.type}</code>
                    </td>
                    <td>{e.decision ? <span className={`badge ${toneFor(e.decision)}`}>{e.decision}</span> : <span className="faint">—</span>}</td>
                    <td className="faint">
                      {e.actorId ? <code>{e.actorId}</code> : null}
                      {e.agentId ? <code style={{ marginLeft: e.actorId ? 6 : 0 }}>{e.agentId}</code> : null}
                      {e.actorId === undefined && e.agentId === undefined ? "—" : null}
                    </td>
                    <td className="faint">{e.resourceId ? <code>{e.resourceId}</code> : "—"}</td>
                    <td className="faint">
                      {/* The deciding policy and version — the "why", never the private content. */}
                      {e.policyId ? (
                        <code>
                          {e.policyId}
                          {e.policyVersion !== undefined ? `·v${e.policyVersion}` : ""}
                        </code>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* A user-safe reason names the policy and decision class, not the trigger. */}
          {chain.events.some((e) => e.reason !== undefined) ? (
            <span className="faint" style={{ fontSize: 12 }}>
              {chain.events.find((e) => e.reason !== undefined)?.reason}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
