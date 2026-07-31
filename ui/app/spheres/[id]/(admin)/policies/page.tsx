import { PolicyManager } from "../../../../../components/PolicyManager";
import { apiBaseUrl, getCapabilities, getMembers, getPolicies, resolveActingAdmin } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

/**
 * Policy Engine — the Sphere's permission rules on their own page (RFC-003). The
 * engine is deny-by-default: a capability is denied unless a rule allows it, and a
 * rule may raise an action to approval. This screen views and edits the rules; it
 * decides nothing at call time — the engine does, before any runtime.
 */
export default async function PolicyEngineSection({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { actor?: string };
}) {
  const base = apiBaseUrl();
  const id = params.id;
  const [members, policies, capabilities] = await Promise.all([
    getMembers(base, id).catch(() => []),
    getPolicies(base, id).catch(() => []),
    getCapabilities(base).catch(() => []),
  ]);
  const { admin } = resolveActingAdmin(members, searchParams.actor);

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">Policy engine</span>
          <h3>Permissions &amp; rules · {policies.length}</h3>
        </div>
        <span className="badge brand">deny by default</span>
      </div>
      <div className="panel-body">
        <PolicyManager sphereId={id} actor={admin} policies={policies} capabilities={capabilities} />
      </div>
    </div>
  );
}
