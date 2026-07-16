/**
 * KinOS read API server entrypoint.
 *
 * Wires the router to the durable SQLite stores and listens on $KINOS_API_PORT
 * (default 8787). Reads expose already-governed state; the governed write path
 * (capability execution) runs the core pipeline through a local executor.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chown, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { PROVISIONING_TOOLS, RUNTIME_GOVERNANCE_TOOLS, TuiTicketStore, type AgentRuntime } from "@kinos/core";
import { LocalCapabilityExecutor, type CapabilityHandler } from "@kinos/executor-local";
import {
  FsEncryptedBlobStore,
  SqliteAgentTokenStore,
  SqliteApprovalStore,
  SqliteAuditSink,
  SqliteSessionStore,
  SqliteSnapshotStore,
  SqliteSphereStore,
} from "@kinos/persistence-sqlite";
import type { HermesFsPort } from "@kinos/runtime-hermes";
import { OpenAiRuntime } from "@kinos/runtime-openai";

import { createApiServer } from "./server.js";
import {
  backupAgentState,
  projectAgentConfig,
  restoreAgentState,
  type RuntimeBackupInput,
  type RuntimeGovernanceDeps,
  type RuntimeProjectInput,
  type RuntimeRestoreInput,
} from "./runtime-governance.js";
import {
  createAgentProvision,
  createSphereProvision,
  inviteMemberProvision,
  managePolicyProvision,
  updateAgentProvision,
  type CreateAgentInput,
  type CreateSphereInput,
  type InviteMemberInput,
  type ManagePolicyInput,
  type ProvisioningDeps,
  type UpdateAgentInput,
} from "./provisioning.js";

/**
 * The Harness's inference backend. Hermes is the sole Harness (ADR-008 §3): an
 * agent always executes inside it and never on a bare or alternative runtime, so
 * there is no harness selection here — the choice would be the one thing ADR-008
 * says the architecture must not offer.
 *
 * This is NOT the provider/model choice. Which provider and model the agent runs
 * on stays an RFC-004/RFC-009 governance decision, projected into the agent's
 * Hermes profile (`model:` block) by runtime.config.project — Hermes reaches its
 * own backend (Ollama local, OpenAI cloud) from that projected profile. The layer
 * below is only how KinOS talks TO Hermes.
 *
 * Hermes exposes an OpenAI-compatible API server (`/v1/chat/completions`,
 * `/v1/models`, Bearer-authenticated by API_SERVER_KEY — verified against the
 * NousResearch/hermes-agent image), so this reuses the OpenAI adapter pointed at
 * it. There is no bespoke Hermes runtime.
 */
function harnessInference(): AgentRuntime {
  return new OpenAiRuntime({
    baseUrl: process.env["HERMES_BASE_URL"] ?? "http://localhost:8642/v1",
    apiKey: process.env["HERMES_API_KEY"] ?? "",
  });
}

function ensureDir(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

const store = new SqliteSphereStore(ensureDir(process.env["KINOS_DB"] ?? "data/kinos.sqlite"));
const approvals = new SqliteApprovalStore(ensureDir(process.env["KINOS_APPROVALS_DB"] ?? "data/approvals.sqlite"));
const audit = new SqliteAuditSink(ensureDir(process.env["KINOS_AUDIT_DB"] ?? "data/audit.sqlite"));
const sessions = new SqliteSessionStore(ensureDir(process.env["KINOS_SESSIONS_DB"] ?? "data/sessions.sqlite"));
const tokens = new SqliteAgentTokenStore(ensureDir(process.env["KINOS_TOKENS_DB"] ?? "data/tokens.sqlite"));
const snapshots = new SqliteSnapshotStore(ensureDir(process.env["KINOS_SNAPSHOTS_DB"] ?? "data/snapshots.sqlite"));

// Snapshot blob encryption key (ADR-007: from the secret store; env in dev).
// A generated key is fine for a single run but makes prior blobs unreadable on
// restart — set KINOS_SNAPSHOT_KEY (64 hex chars) to persist across restarts.
const snapshotKeyHex = process.env["KINOS_SNAPSHOT_KEY"];
const snapshotKey = snapshotKeyHex !== undefined && snapshotKeyHex.length === 64
  ? Buffer.from(snapshotKeyHex, "hex")
  : randomBytes(32);
const blobs = new FsEncryptedBlobStore({ dir: process.env["KINOS_SNAPSHOT_DIR"] ?? "data/snapshots", key: snapshotKey });

// Runtime-governance executor deps (RFC-007/ADR-007). Writes each agent's
// runtime profile under the Hermes home and provisions its Sphere-MCP token.
//
// The profile lands on a volume shared with the Hermes container, which runs as
// HERMES_UID/GID (10000 by default) while this API writes as its own user. Files
// it cannot read make Hermes fail to open the profile at all, so ownership is
// handed over on write. Set KINOS_HARNESS_UID/GID to 0 (or anything else) if the
// deployment runs Hermes as another user; chown failures are non-fatal because a
// same-user deployment does not need it.
const harnessUid = Number(process.env["KINOS_HARNESS_UID"] ?? process.env["HERMES_UID"] ?? "10000");
const harnessGid = Number(process.env["KINOS_HARNESS_GID"] ?? process.env["HERMES_GID"] ?? "10000");
const handToHarness = async (path: string): Promise<void> => {
  if (!Number.isFinite(harnessUid) || !Number.isFinite(harnessGid)) return;
  try {
    await chown(path, harnessUid, harnessGid);
  } catch {
    // Not permitted / not needed (same user, or a non-root API): leave as-is.
  }
};
const nodeFs: HermesFsPort = {
  mkdir: async (p) => {
    await mkdir(p, { recursive: true });
    await handToHarness(p);
  },
  readFile: async (p) => {
    try {
      return await readFile(p, "utf8");
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
  },
  writeFile: async (p, c) => {
    await writeFile(p, c);
    await handToHarness(p);
  },
};
const mcpPublicUrl = (process.env["KINOS_PUBLIC_URL"] ?? `http://localhost:${process.env["KINOS_API_PORT"] ?? "8787"}`).replace(/\/+$/, "");
const govDeps: RuntimeGovernanceDeps = {
  store,
  tokens,
  home: process.env["HERMES_HOME"] ?? "data/hermes",
  fs: nodeFs,
  gatewayEndpoint: (sphereId) => `${mcpPublicUrl}/spheres/${encodeURIComponent(sphereId)}/mcp`,
  // Where the Harness reaches a local provider when the Sphere's profile does not
  // pin one. Deployment detail only — the provider/model choice stays governed.
  providerBaseUrl: (providerId) =>
    providerId === "ollama" ? (process.env["HARNESS_OLLAMA_URL"] ?? "http://host.docker.internal:11434/v1") : undefined,
  auditSink: audit,
  snapshots,
  blobs,
  newSnapshotId: () => `snap_${randomUUID()}`,
};

// Provisioning executor deps (RFC-008): the side effects generate ids in the
// application layer (keeping the core deterministic) and mutate the canonical
// SphereStore behind the governed provisioning capabilities.
const provDeps: ProvisioningDeps = {
  store,
  auditSink: audit,
  newSphereId: () => `sph_${randomUUID().slice(0, 8)}`,
  newMemberId: () => `mbr_${randomUUID().slice(0, 8)}`,
  newIdentityId: () => `idy_${randomUUID().slice(0, 8)}`,
  newAgentId: () => `agt_${randomUUID().slice(0, 8)}`,
};

// Local executor for the governed write path (mirrors the CLI's handler set),
// plus the runtime-governance tools (RFC-007): config.project writes the agent's
// profile + provisions its token; session.backup/restore capture/restore the
// agent's runtime state as an opaque encrypted blob; and the provisioning tools
// (RFC-008): create Sphere / invite member / create + update agent.
const executor = new LocalCapabilityExecutor(
  new Map<string, CapabilityHandler>([
    ["local.calendar", async (input) => ({ created: true, input })],
    // RFC-011 demo read behind calendar.read: synthetic events, no real calendar.
    // A genuine calendar integration replaces this handler without any policy change.
    ["local.calendar_read", async (input) => ({ events: [{ title: "Family dinner", start: "2026-07-18T19:00:00Z" }], input })],
    ["local.pay", async (input) => ({ paid: true, input })],
    ["local.echo", async (input) => ({ echoed: input })],
    [RUNTIME_GOVERNANCE_TOOLS["runtime.config.project"], async (input) => projectAgentConfig(govDeps, input as RuntimeProjectInput)],
    [RUNTIME_GOVERNANCE_TOOLS["runtime.session.backup"], async (input) => backupAgentState(govDeps, input as RuntimeBackupInput)],
    [RUNTIME_GOVERNANCE_TOOLS["runtime.session.restore"], async (input) => restoreAgentState(govDeps, input as RuntimeRestoreInput)],
    [PROVISIONING_TOOLS["sphere.create"], async (input) => createSphereProvision(provDeps, input as CreateSphereInput)],
    [PROVISIONING_TOOLS["member.invite"], async (input) => inviteMemberProvision(provDeps, input as InviteMemberInput)],
    [PROVISIONING_TOOLS["agent.create"], async (input) => createAgentProvision(provDeps, input as CreateAgentInput)],
    [PROVISIONING_TOOLS["agent.update_config"], async (input) => updateAgentProvision(provDeps, input as UpdateAgentInput)],
    [PROVISIONING_TOOLS["policy.manage"], async (input) => managePolicyProvision(provDeps, input as ManagePolicyInput)],
  ]),
);

// Attach tickets live in memory: they are redeemed seconds after minting, and
// forgetting them on restart loses nothing durable (unlike memory or policy).
const tuiTickets = new TuiTicketStore();
setInterval(() => tuiTickets.prune(), 60_000).unref();

const port = Number(process.env["KINOS_API_PORT"] ?? "8787");
const server = createApiServer(
  {
    store,
    approvals,
    audit,
    auditSink: audit,
    executor,
    sessions,
    runtime: harnessInference(),
    // Harness terminal (ADR-008 §6): tickets are minted only after the Policy
    // Engine allows runtime.session.attach, and redeemed once by the bridge.
    tuiTickets,
    newTuiTicket: () => randomBytes(32).toString("hex"),
    newCorrelationId: () => randomUUID(),
    newApprovalId: () => `apr_${randomUUID()}`,
    newSessionId: () => `ses_${randomUUID()}`,
  },
  // Sphere MCP gateway (RFC-007, ADR-007): the governed tool surface Hermes calls.
  {
    store,
    tokens,
    executor,
    auditSink: audit,
    approvals,
    newApprovalId: () => `apr_${randomUUID()}`,
    newCorrelationId: () => randomUUID(),
  },
);
server.listen(port, () => console.log(`KinOS API listening on :${port}`));
