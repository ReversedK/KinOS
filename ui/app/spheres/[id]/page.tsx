import { AgentConfig } from "../../../components/AgentConfig";
import { Calendar } from "../../../components/Calendar";
import { DevActorSwitcher } from "../../../components/DevActorSwitcher";
import { DeployAgent } from "../../../components/DeployAgent";
import { InviteMember } from "../../../components/InviteMember";
import { Notes } from "../../../components/Notes";
import { PolicyManager } from "../../../components/PolicyManager";
import { SphereNav } from "../../../components/SphereNav";
import {
  ageProfileForRole,
  apiBaseUrl,
  getAgents,
  getCapabilities,
  getIntegrations,
  getMembers,
  getPolicies,
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
export default async function SpherePage({ params, searchParams }: { params: { id: string }; searchParams: { actor?: string } }) {
  const base = apiBaseUrl();
  const id = params.id;
  try {
    const [sphere, members, agents, runtime, integrations, capabilities, policies] = await Promise.all([
      getSphere(base, id),
      getMembers(base, id),
      getAgents(base, id),
      getRuntime(base, id),
      getIntegrations(base, id),
      getCapabilities(base).catch(() => []),
      getPolicies(base, id),
    ]);

    // The administrator acting in the console (dev: the founder/first parent;
    // anticipates real auth / RFC-006 impersonation). Provisioning is governed
    // by the seeded admin policy — being "admin in the UI" grants nothing extra.
    const adminMember = members.find((m) => m.id === searchParams.actor) ?? members.find((m) => m.role === "parent") ?? members[0];
    const admin: ActingSubject = adminMember
      ? { memberId: adminMember.id, role: adminMember.role, ageProfile: ageProfileForRole(adminMember.role) }
      : { role: "parent", ageProfile: "adult" };
    const runMembers = members.map((m) => ({ id: m.id, role: m.role }));

    const stats = [
      { label: "members", value: String(members.length) },
      { label: "agents", value: String(agents.length) },
      { label: "runtime", value: runtime.provider, sub: runtime.model },
      { label: "harness", value: runtime.harness.runtime, sub: runtime.harness.model },
      { label: "connectors", value: String(integrations.filter((i) => i.status === "enabled").length) },
      { label: "active rules", value: String(policies.filter((policy) => policy.status === "active").length) },
    ];

    return (
      <div className="container">
        <div className="crumbs">
          <a href="/">spheres</a> / <span className="mono">{sphere.id}</span>
        </div>

        <div className="admin-shell">
          <aside className="admin-rail">
            <SphereNav />
            <DevActorSwitcher members={members} actorId={adminMember?.id} />
            <div className="rail-note">
              <span className="eyebrow">Security model</span>
              <p>The selected identity never bypasses policy. It only determines whose existing rights apply.</p>
            </div>
          </aside>
          <main className="stack loose admin-content">
          <div id="overview" className="row between section-anchor" style={{ alignItems: "flex-start" }}>
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
          <div id="members" className="panel section-anchor">
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
          <div id="agents" className="panel section-anchor">
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

          {/* Permissions */}
          <div id="permissions" className="panel section-anchor">
            <div className="panel-head">
              <div>
                <span className="eyebrow">Policy engine</span>
                <h3>Permissions & rules · {policies.length}</h3>
              </div>
              <span className="badge brand">deny by default</span>
            </div>
            <div className="panel-body">
              <PolicyManager sphereId={id} actor={admin} policies={policies} capabilities={capabilities} />
            </div>
          </div>

          {/* Runtime */}
          <div id="runtime" className="panel section-anchor">
            <div className="panel-head">
              <h3>Runtime & harness</h3>
              <span className="badge">
                <span className="dot" />
                {runtime.execution}
                {runtime.execution === "cloud" ? (runtime.cloudInferenceEnabled ? " · cloud on" : " · cloud disabled") : ""}
              </span>
            </div>
            <div className="panel-body stack">
              <div className="runtime-explainer">
                <span className="runtime-number">01</span>
                <div className="stack tight">
                <span className="eyebrow">Sphere inference profile</span>
                <p className="section-intro">The governed default used for KinOS conversations. It chooses where inference runs and which model is requested; changing it never changes identities, memory, or permissions.</p>
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
                </div>
              </div>
              <div className="runtime-explainer">
                <span className="runtime-number">02</span>
                <div className="stack tight">
                <span className="eyebrow">Active agent harness</span>
                <p className="section-intro">
                  The governed environment every agent runs inside — it hosts agent profiles and tool calling, and never executes bare. Hermes is
                  the only harness, so there is nothing to choose here; KinOS remains the authority for permissions and exposed capabilities, and
                  the inference backend below is the governed choice projected into its profile.
                </p>
                <div className="row" style={{ gap: "var(--s4)" }}>
                  <span>
                    harness <code>{runtime.harness.runtime}</code>
                  </span>
                  {runtime.harness.provider ? (
                    <span>
                      backend <code>{runtime.harness.provider}</code>
                    </span>
                  ) : null}
                  {runtime.harness.model ? (
                    <span>
                      model <code>{runtime.harness.model}</code>
                    </span>
                  ) : null}
                  {runtime.harness.baseUrl ? (
                    <span className="faint">
                      endpoint <code>{runtime.harness.baseUrl}</code>
                    </span>
                  ) : null}
                </div>
                </div>
              </div>
              <hr className="hairline" style={{ margin: 0 }} />
              <SetRuntime sphereId={id} actor={admin} />
            </div>
          </div>

          {/* Connectors */}
          <div id="connectors" className="panel section-anchor">
            <div className="panel-head">
              <h3>Connectors</h3>
            </div>
            <div className="panel-body">
              <Connectors sphereId={id} actor={admin} integrations={integrations} />
            </div>
          </div>

          {/* Calendar — real Sphere-scoped calendar (RFC-012) */}
          <div id="calendar" className="panel section-anchor">
            <div className="panel-head">
              <h3>Calendar</h3>
              <span className="faint" style={{ fontSize: 12 }}>local-first · Sphere-scoped</span>
            </div>
            <div className="panel-body">
              <Calendar sphereId={id} actor={admin} />
            </div>
          </div>

          {/* Notes — real canonical memory (RFC-013/015) */}
          <div id="notes" className="panel section-anchor">
            <div className="panel-head">
              <h3>Notes</h3>
              <span className="faint" style={{ fontSize: 12 }}>canonical memory · policy-scoped</span>
            </div>
            <div className="panel-body">
              <Notes sphereId={id} actor={admin} />
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
          </main>
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
