/**
 * Sphere export / import (ADR-002 "Export and portability"; results-contract
 * §17). Produces a documented, versioned, open JSON snapshot so a Sphere can be
 * exported and restored. Canonical memory is included with ownership,
 * visibility, sensitivity and lifecycle; embeddings are NOT exported (they are
 * derived and regenerable — coding principle 5). The format is documented in
 * docs/architecture/export-format.md.
 *
 * Pure domain: no I/O, no provider/runtime imports. The caller does the actual
 * file/transfer I/O and the governing export policy check (export of data
 * leaving the local environment is itself a governed action).
 */

import type { Agent } from "../agent/agent.js";
import type { Identity } from "../identity/identity.js";
import type { MemoryItem } from "../memory/memory.js";
import type { Policy } from "../policy/types.js";
import type { Sphere } from "../sphere/sphere.js";

export const EXPORT_FORMAT = "kinos.sphere.export";
export const EXPORT_VERSION = 1;

export interface SphereExport {
  readonly format: typeof EXPORT_FORMAT;
  readonly version: number;
  readonly exportedAt: string;
  /** Members are embedded in the Sphere. */
  readonly sphere: Sphere;
  readonly identities: readonly Identity[];
  readonly agents: readonly Agent[];
  readonly memory: readonly MemoryItem[];
  readonly policies: readonly Policy[];
}

export interface ExportSphereInput {
  readonly sphere: Sphere;
  readonly identities: readonly Identity[];
  readonly agents: readonly Agent[];
  readonly memory: readonly MemoryItem[];
  readonly policies: readonly Policy[];
  readonly exportedAt: string;
}

export function exportSphere(input: ExportSphereInput): SphereExport {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: input.exportedAt,
    sphere: input.sphere,
    identities: [...input.identities],
    agents: [...input.agents],
    memory: [...input.memory],
    policies: [...input.policies],
  };
}

export interface ImportedSphere {
  readonly sphere: Sphere;
  readonly identities: readonly Identity[];
  readonly agents: readonly Agent[];
  readonly memory: readonly MemoryItem[];
  readonly policies: readonly Policy[];
  readonly exportedAt: string;
}

/**
 * Validate and parse an export snapshot. Fails closed: a non-object payload, an
 * unknown format or an unsupported version are refused rather than guessed.
 */
export function importSphere(data: unknown): ImportedSphere {
  if (typeof data !== "object" || data === null) {
    throw new Error("Sphere import payload must be an object");
  }
  const snap = data as Partial<SphereExport>;
  if (snap.format !== EXPORT_FORMAT) {
    throw new Error(`Unknown export format: ${String(snap.format)}`);
  }
  if (snap.version !== EXPORT_VERSION) {
    throw new Error(`Unsupported export version: ${String(snap.version)}`);
  }
  if (
    snap.sphere === undefined ||
    typeof snap.exportedAt !== "string" ||
    !Array.isArray(snap.identities) ||
    !Array.isArray(snap.agents) ||
    !Array.isArray(snap.memory) ||
    !Array.isArray(snap.policies)
  ) {
    throw new Error("Malformed export snapshot: missing required sections");
  }
  return {
    sphere: snap.sphere,
    identities: snap.identities,
    agents: snap.agents,
    memory: snap.memory,
    policies: snap.policies,
    exportedAt: snap.exportedAt,
  };
}
