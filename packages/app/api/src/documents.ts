/**
 * Shared "documents source" logic (RFC-029 + RFC-031).
 *
 * The single implementation of how KinOS reads its own Sphere as a documents
 * source: the Sphere's SHARED (`shared_with_sphere`) content, read-only and
 * policy-scoped, never a member's private memory. Used by both the RFC-029 local
 * `document.*` handlers and the RFC-031 `local` integration provider, so the two
 * can never drift.
 *
 * Pure over its injected SphereStore; no provider SDK.
 */

import {
  importSphere,
  resolveReadableMemory,
  type ExecutionContext,
  type SphereStore,
} from "@kinos/core";

/** A document as returned to a caller: id + content + optional summary. */
export interface DocumentHit {
  readonly id: string;
  readonly content: string;
  readonly summary?: string;
}

/**
 * A deterministic extractive summary (RFC-029 MVP): the first sentences up to a
 * bound, no model call. A real summarizer is a later binding — the capability and
 * its governance are unchanged when it is swapped in.
 */
export function extractiveSummary(content: string, maxChars = 240): string {
  const text = content.trim().replace(/\s+/g, " ");
  if (text.length <= maxChars) return text;
  const clipped = text.slice(0, maxChars);
  // Prefer a sentence boundary within the bound; else fall back to a word break.
  const lastStop = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("! "), clipped.lastIndexOf("? "));
  if (lastStop >= maxChars * 0.5) return clipped.slice(0, lastStop + 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 0 ? lastSpace : maxChars)}…`;
}

/**
 * Search the Sphere's shared documents. Policy-scoped (a subject sees only what it
 * may read) AND narrowed to `shared_with_sphere` — a private item is never a
 * document. An optional query substring filters the already-authorized set.
 */
export async function searchSharedDocuments(
  spheres: SphereStore,
  ctx: ExecutionContext,
  query: string | undefined,
): Promise<{ documents: DocumentHit[] }> {
  const snap = await spheres.load(ctx.sphereId);
  if (snap === undefined) return { documents: [] };
  const imported = importSphere(snap);
  const readable = resolveReadableMemory(ctx.subject, imported.memory, imported.policies, {
    sphereId: ctx.sphereId,
    time: ctx.time,
    correlationId: ctx.correlationId,
  }).filter((m) => m.visibility === "shared_with_sphere");
  const q = typeof query === "string" ? query.trim().toLowerCase() : "";
  const matched = q === "" ? readable : readable.filter((m) => `${m.content} ${m.summary ?? ""}`.toLowerCase().includes(q));
  return { documents: matched.map((m) => ({ id: m.id, content: m.content, ...(m.summary !== undefined ? { summary: m.summary } : {}) })) };
}

/**
 * Summarize one shared document by id. Only a `shared_with_sphere` item is
 * summarizable — never a private one (that item is "not found" as a document).
 */
export async function summarizeSharedDocument(
  spheres: SphereStore,
  ctx: ExecutionContext,
  documentId: string,
): Promise<{ id: string; summary: string }> {
  const snap = await spheres.load(ctx.sphereId);
  if (snap === undefined) throw new Error(`Sphere ${ctx.sphereId} not found`);
  const imported = importSphere(snap);
  const readable = resolveReadableMemory(ctx.subject, imported.memory, imported.policies, {
    sphereId: ctx.sphereId,
    time: ctx.time,
    correlationId: ctx.correlationId,
  });
  const doc = readable.find((m) => m.id === documentId && m.visibility === "shared_with_sphere");
  if (doc === undefined) throw new Error(`Document ${documentId} not found`);
  return { id: doc.id, summary: doc.summary ?? extractiveSummary(doc.content) };
}
