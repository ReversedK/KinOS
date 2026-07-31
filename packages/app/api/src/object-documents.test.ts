import { describe, expect, it } from "vitest";

import { InMemoryObjectStore, bucketForSphere, objectDocumentsProvider } from "./object-documents.js";
import type { IntegrationProviderCtx } from "./integration-executor.js";

function ctx(sphereId = "sph_1"): IntegrationProviderCtx {
  return {
    sphereId,
    subject: { memberId: "mbr_1", role: "parent", ageProfile: "adult" },
    correlationId: "cor_1",
    secret: async () => undefined,
    scopes: [],
    now: () => "2026-07-31T00:00:00.000Z",
    newId: () => "id_1",
  };
}

describe("RFC-048 object-documents provider", () => {
  it("derives a valid, per-Sphere bucket name", () => {
    expect(bucketForSphere("sph_ABC123")).toBe("kinos-docs-sph-abc123");
    // Only [a-z0-9-], <=63 chars.
    expect(bucketForSphere("SPH_@!$x")).toMatch(/^[a-z0-9-]+$/);
  });

  it("uploads a document, then finds and summarizes it (full round trip)", async () => {
    const provider = objectDocumentsProvider(new InMemoryObjectStore());
    const up = await provider("document.upload", { name: "recipe.txt", content: "Mix flour and water. Bake for 20 minutes." }, ctx());
    expect(up).toEqual({ uploaded: true, id: "recipe.txt" });

    const found = (await provider("document.search", {}, ctx())) as { documents: Array<{ id: string; content: string }> };
    expect(found.documents.map((d) => d.id)).toEqual(["recipe.txt"]);

    const sum = (await provider("document.summarize", { documentId: "recipe.txt" }, ctx())) as { id: string; summary: string };
    expect(sum.id).toBe("recipe.txt");
    expect(sum.summary.length).toBeGreaterThan(0);
  });

  it("search matches on key or content, case-insensitively", async () => {
    const provider = objectDocumentsProvider(new InMemoryObjectStore());
    await provider("document.upload", { name: "taxes-2025.txt", content: "Annual return figures." }, ctx());
    await provider("document.upload", { name: "notes.txt", content: "Remember the DENTIST appointment." }, ctx());

    const byKey = (await provider("document.search", { query: "taxes" }, ctx())) as { documents: Array<{ id: string }> };
    expect(byKey.documents.map((d) => d.id)).toEqual(["taxes-2025.txt"]);

    const byContent = (await provider("document.search", { query: "dentist" }, ctx())) as { documents: Array<{ id: string }> };
    expect(byContent.documents.map((d) => d.id)).toEqual(["notes.txt"]);
  });

  it("isolates each Sphere to its own bucket", async () => {
    const provider = objectDocumentsProvider(new InMemoryObjectStore());
    await provider("document.upload", { name: "secret.txt", content: "sphere one only" }, ctx("sph_1"));
    const other = (await provider("document.search", {}, ctx("sph_2"))) as { documents: unknown[] };
    expect(other.documents).toEqual([]);
  });

  it("summarize on a missing id returns a graceful not-found, not a throw", async () => {
    const provider = objectDocumentsProvider(new InMemoryObjectStore());
    const res = (await provider("document.summarize", { documentId: "nope.txt" }, ctx())) as { id: string; summary: string };
    expect(res.summary).toContain("not found");
  });

  it("upload rejects a missing name or non-string content", async () => {
    const provider = objectDocumentsProvider(new InMemoryObjectStore());
    await expect(provider("document.upload", { content: "x" }, ctx())).rejects.toThrow(/name/);
    await expect(provider("document.upload", { name: "a.txt" }, ctx())).rejects.toThrow(/content/);
  });

  it("refuses a capability it does not implement", async () => {
    const provider = objectDocumentsProvider(new InMemoryObjectStore());
    await expect(provider("calendar.read", {}, ctx())).rejects.toThrow(/does not implement/);
  });
});
