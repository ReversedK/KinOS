import { apiBaseUrl, getAgents, getMembers, getSphere } from "../../../../lib/api";
import { Chat } from "./Chat";

export const dynamic = "force-dynamic";

// Chat with an agent (RFC-005). The page loads members + agents (facts only) and
// mounts the client Chat component, which talks to the governed chat endpoints.
export default async function ChatPage({ params }: { params: { id: string } }) {
  const base = apiBaseUrl();
  try {
    const [sphere, members, agents] = await Promise.all([
      getSphere(base, params.id),
      getMembers(base, params.id),
      getAgents(base, params.id),
    ]);
    return (
      <main>
        <p style={{ marginTop: 0 }}>
          <a href={`/spheres/${encodeURIComponent(params.id)}`} style={{ color: "#8ab4f8" }}>
            ← {sphere.name}
          </a>
        </p>
        <h2 style={{ marginBottom: 0 }}>Chat</h2>
        <Chat
          baseUrl={base}
          sphereId={params.id}
          members={members.map((m) => ({ id: m.id, role: m.role }))}
          agents={agents.map((a) => ({ id: a.id, name: a.name }))}
        />
      </main>
    );
  } catch (e) {
    return (
      <main>
        <p style={{ marginTop: 0 }}>
          <a href="/" style={{ color: "#8ab4f8" }}>← Spheres</a>
        </p>
        <p style={{ color: "#f28b82" }}>Could not load chat for {params.id}: {(e as Error).message}</p>
      </main>
    );
  }
}
