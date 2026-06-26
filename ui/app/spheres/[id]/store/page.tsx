import { apiBaseUrl, getInstalledPackages, getMembers, getSphere, getStoreCatalog } from "../../../../lib/api";
import { Store } from "./Store";

export const dynamic = "force-dynamic";

// Package store (RFC-002): browse the curated catalog and manage installed
// packages. The client component talks to the governed store endpoints; install
// never grants use (policies do), and the Policy Engine gates every call.
export default async function StorePage({ params }: { params: { id: string } }) {
  const base = apiBaseUrl();
  try {
    const [sphere, members, catalog, installed] = await Promise.all([
      getSphere(base, params.id),
      getMembers(base, params.id),
      getStoreCatalog(base),
      getInstalledPackages(base, params.id),
    ]);
    return (
      <main>
        <p style={{ marginTop: 0 }}>
          <a href={`/spheres/${encodeURIComponent(params.id)}`} style={{ color: "#8ab4f8" }}>
            ← {sphere.name}
          </a>
        </p>
        <Store
          baseUrl={base}
          sphereId={params.id}
          members={members.map((m) => ({ id: m.id, role: m.role }))}
          catalog={catalog}
          installed={installed}
        />
      </main>
    );
  } catch (e) {
    return (
      <main>
        <p style={{ marginTop: 0 }}>
          <a href="/" style={{ color: "#8ab4f8" }}>← Spheres</a>
        </p>
        <p style={{ color: "#f28b82" }}>Could not load the store for {params.id}: {(e as Error).message}</p>
      </main>
    );
  }
}
