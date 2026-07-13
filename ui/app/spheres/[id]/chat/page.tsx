import { apiBaseUrl, getAgents, getMembers, getSphere } from "../../../../lib/api";
import { Chat } from "./Chat";

export const dynamic = "force-dynamic";

// Test agents in real conditions (RFC-005). Loads members + agents (facts only)
// and mounts the client Chat console, which talks to the governed chat endpoints.
export default async function ChatPage({ params }: { params: { id: string } }) {
  const base = apiBaseUrl();
  const id = params.id;
  try {
    const [sphere, members, agents] = await Promise.all([
      getSphere(base, id),
      getMembers(base, id),
      getAgents(base, id),
    ]);
    return (
      <div className="container">
        <div className="crumbs">
          <a href="/">spheres</a> / <a href={`/spheres/${encodeURIComponent(id)}`}>{sphere.name}</a> / test
        </div>
        <div className="stack">
          <div className="stack tight">
            <span className="eyebrow">real-condition testing</span>
            <h1 className="title">Test agents</h1>
            <p className="help">
              Talk to a deployed agent as any member. Turns run through the governed runtime — with the Hermes runtime the agent
              reaches back into the Sphere MCP for exactly its policy-authorized capabilities.
            </p>
          </div>
          {agents.length === 0 ? (
            <div className="empty">
              No agents to test yet. Deploy one from the{" "}
              <a href={`/spheres/${encodeURIComponent(id)}`} className="mono" style={{ color: "var(--brand)" }}>
                Sphere console
              </a>
              .
            </div>
          ) : (
            <Chat
              sphereId={id}
              members={members.map((m) => ({ id: m.id, role: m.role }))}
              agents={agents.map((a) => ({ id: a.id, name: a.name, capabilities: a.enabledCapabilities }))}
            />
          )}
        </div>
      </div>
    );
  } catch (e) {
    return (
      <div className="container narrow">
        <div className="crumbs">
          <a href="/">spheres</a> / test
        </div>
        <div className="note deny">Could not load chat for {id} — {(e as Error).message}</div>
      </div>
    );
  }
}
