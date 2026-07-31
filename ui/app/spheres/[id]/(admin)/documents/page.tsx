import { Documents } from "../../../../../components/Documents";
import { apiBaseUrl, getMembers, resolveActingAdmin } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

/**
 * Documents section (RFC-048) — package-gated (the nav only shows it when the
 * `documents` package is installed). Upload, search and summarize the Sphere's
 * connected documents source through the governed capability endpoints. This page
 * only resolves the acting identity; the panel triggers the capabilities and the
 * Policy Engine decides.
 */
export default async function DocumentsSection({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { actor?: string };
}) {
  const base = apiBaseUrl();
  const id = params.id;
  const members = await getMembers(base, id).catch(() => []);
  const { admin } = resolveActingAdmin(members, searchParams.actor);

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Documents</h3>
        <span className="faint" style={{ fontSize: 12 }}>connected source · policy-scoped</span>
      </div>
      <div className="panel-body">
        <Documents sphereId={id} actor={admin} />
      </div>
    </div>
  );
}
