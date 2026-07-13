import { AgentConfig } from "../../../components/AgentConfig";
import { DeployAgent } from "../../../components/DeployAgent";
import { InviteMember } from "../../../components/InviteMember";
import {
  ageProfileForRole,
  apiBaseUrl,
  getAgents,
  getCapabilities,
  getIntegrations,
  getMembers,
  getRuntime,
  getSphere,
  type ActingSubject,
} from "../../../lib/api";
import { Connectors } from "./Connectors";
import { RunCapability } from "./RunCapability";
import { SetRuntime } from "./SetRuntime";

// Read-only Sphere detail composed with governed write affordances (RFC-003):
// members and agents (security facts only — role, status, capabilities), never
// private profile or memory content (§18). Every action triggers the governed
// pipeline; the Policy Engine decides.
export default async function SpherePage({ params }: { params: { id: string } }) {
  const base = apiBaseUrl();
  const id = params.id;
  try {
    const [sphere, members, agents, runtime, integrations, capabilities] = await Promise.all([
      getSphere(base, id),
      getMembers(base, id),
      getAgents(base, id),
      getRuntime(base, id),
      getIntegrations(base, id),
      getCapabilities(base).catch(() => []),
    ]);

    // The administrator acting in the console (dev: the founder/first parent;
    // anticipates real auth / RFC-006 impersonation). Provisioning is governed
    // by the seeded admin policy — being "admin in the UI" grants nothing extra.
    const adminMember = members.find((m) => m.role === "parent") ?? members[0];
    const admin: ActingSubject = adminMember
      ? { memberId: adminMember.id, role: adminMember.role, ageProfile: ageProfileForRole(adminMember.role) }
      : { role: "parent", ageProfile: "adult" };
    const runMembers = members.map((m) => ({ id: m.id, role: m.role }));

    const stats = [
      { label: "members", value: String(members.length) },
      { label: "agents", value: String(agents.length) },
      { label: "runtime", value: runtime.provider, sub: runtime.model },
      { label: "connectors", value: String(integrations.filter((i) => i.status === "enabled").length) },
    ];

    return (
      <div className="container">
        <div className="crumbs">
          <a href="/">spheres</a> / <span className="mono">{sphere.id}</span>
        </div>

        <div className="stack loose">
          <div className="row between" style={{ alignItems: "flex-start" }}>
            <div className="stack tight">
              <h1 className="title">{sphere.name}</h1>
              <div className="row" style={{ gap: "var(--s2)" }}>
                <span className="pill">{sphere.type}</span>
                <span className={`badge ${sphere.status === "active" ? "allow" : ""}`}>
                  <span className="dot" />
                  {sphere.status}
                </span>
              </div>
            </div>
            <div className="row">
              <a className="btn" href={`/spheres/${encodeURIComponent(id)}/store`}>
                Store
              </a>
              <a className="btn primary" href={`/spheres/${encodeURIComponent(id)}/chat`}>
                Test agents →
              </a>
            </div>
          </div>

          {/* Overview */}
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
            {stats.map((s) => (
              <div key={s.label} className="card" style={{ padding: "var(--s4)" }}>
                <div className="eyebrow">{s.label}</div>
                <div className="mono" style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>
                  {s.value}
                </div>
                {s.sub ? <div className="faint" style={{ fontSize: 12 }}>{s.sub}</div> : null}
              </div>
            ))}
          </div>

          {/* Members */}
          <div className="panel">
            <div className="panel-head">
              <h3>Members · {members.length}</h3>
              <InviteMember sphereId={id} admin={admin} />
            </div>
            <div className="panel-body flush">
              <div className="tablewrap">
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th>role</th>
                      <th>member id</th>
                      <th>status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.id}>
                        <td>
                          <span className="badge">{m.role}</span>
                          {["child", "teenager"].includes(m.role) ? <span className="badge info" style={{ marginLeft: 6 }}>minor</span> : null}
                        </td>
                        <td>
                          <code>{m.id}</code>
                        </td>
                        <td className="faint">{m.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Agents */}
          <div className="panel">
            <div className="panel-head">
              <h3>Agents · {agents.length}</h3>
              <DeployAgent sphereId={id} admin={admin} members={members} capabilities={capabilities} />
            </div>
            <div className="panel-body">
              {agents.length === 0 ? (
                <div className="empty">
                  No agents yet. Deploy one for a member with a capability scope — it can then be tested under the governed pipeline.
                </div>
              ) : (
                <div className="stack">
                  {agents.map((a) => {
                    const owner = members.find((m) => m.id === a.ownerId);
                    return (
                      <div key={a.id} className="card">
                        <div className="row between" style={{ marginBottom: "var(--s3)" }}>
                          <div>
                            <div style={{ fontWeight: 600 }}>{a.name}</div>
                            <div className="faint" style={{ fontSize: 12 }}>
                              owner <code>{a.ownerId}</code>
                              {owner ? ` · ${owner.role}` : ""}
                              {a.modelPreference ? (
                                <>
                                  {" "}
                                  · model <code>{a.modelPreference}</code>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        <AgentConfig sphereId={id} admin={admin} agent={a} capabilities={capabilities} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Runtime */}
          <div className="panel">
            <div className="panel-head">
              <h3>Inference runtime</h3>
              <span className="badge">
                <span className="dot" />
                {runtime.execution}
                {runtime.execution === "cloud" ? (runtime.cloudInferenceEnabled ? " · cloud on" : " · cloud disabled") : ""}
              </span>
            </div>
            <div className="panel-body stack">
              <div className="row" style={{ gap: "var(--s4)" }}>
                <span>
                  provider <code>{runtime.provider}</code>
                </span>
                <span>
                  model <code>{runtime.model}</code>
                </span>
                <span className="faint">
                  allowed: {runtime.allowedProviders.join(", ")}
                  {runtime.allowed ? "" : " · current profile not permitted"}
                </span>
              </div>
              <hr className="hairline" style={{ margin: 0 }} />
              <SetRuntime sphereId={id} members={runMembers} />
            </div>
          </div>

          {/* Connectors */}
          <div className="panel">
            <div className="panel-head">
              <h3>Connectors</h3>
            </div>
            <div className="panel-body">
              <Connectors sphereId={id} members={runMembers} integrations={integrations} />
            </div>
          </div>

          {/* Capability test bench */}
          <div className="panel">
            <div className="panel-head">
              <h3>Run a capability</h3>
              <span className="faint" style={{ fontSize: 12 }}>governed — allow / approval / deny</span>
            </div>
            <div className="panel-body">
              <RunCapability sphereId={id} members={runMembers} capabilities={capabilities} />
            </div>
          </div>
        </div>
      </div>
    );
  } catch (e) {
    return (
      <div className="container narrow">
        <div className="crumbs">
          <a href="/">spheres</a> / {id}
        </div>
        <div className="note deny">Could not load Sphere {id} — {(e as Error).message}</div>
      </div>
    );
  }
}
