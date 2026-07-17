import { AgentConfig } from "../../../../../components/AgentConfig";
import { DeployAgent } from "../../../../../components/DeployAgent";
import { apiBaseUrl, getAgents, getCapabilities, getMembers, resolveActingAdmin } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export default async function AgentsSection({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { actor?: string };
}) {
  const base = apiBaseUrl();
  const id = params.id;
  const [members, agents, capabilities] = await Promise.all([
    getMembers(base, id).catch(() => []),
    getAgents(base, id).catch(() => []),
    getCapabilities(base).catch(() => []),
  ]);
  const { admin } = resolveActingAdmin(members, searchParams.actor);

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Agents · {agents.length}</h3>
        <DeployAgent sphereId={id} admin={admin} members={members} capabilities={capabilities} />
      </div>
      <div className="panel-body">
        {agents.length === 0 ? (
          <div className="empty">
            <span className="empty-glyph">◈</span>
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
  );
}
