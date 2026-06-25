/**
 * KinOS MVP CLI.
 *
 * Subcommands:
 *   mvp                       run the results-contract §19 acceptance scenario
 *   init <id> <name>          create and persist a family Sphere
 *   list                      list persisted Sphere ids
 *   show <id>                 show a persisted Sphere summary
 *   export <id>               print a Sphere's export snapshot JSON
 *   run <id> <cap> [adult|child]  run a capability through the governed pipeline
 *   approve <approvalId> [grant|deny]  resolve a pending approval
 *   audit <correlationId>     show an action's audit chain
 *
 * Persistence is SQLite at $KINOS_DB (default ./data/kinos.sqlite); the audit
 * log at $KINOS_AUDIT_DB (default ./data/audit.sqlite). The local model runtime
 * is Ollama at $OLLAMA_BASE_URL.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { LocalCapabilityExecutor, type CapabilityHandler } from "@kinos/executor-local";
import {
  SqliteApprovalStore,
  SqliteAuditSink,
  SqliteSphereStore,
} from "@kinos/persistence-sqlite";
import { OllamaRuntime } from "@kinos/runtime-ollama";

import {
  approveCapability,
  exportSphereJson,
  initSphere,
  listSpheres,
  runCapability,
  showAudit,
  showSphere,
} from "./commands.js";
import { runMvpScenario } from "./scenario.js";

function openStore(): SqliteSphereStore {
  const path = process.env["KINOS_DB"] ?? "data/kinos.sqlite";
  mkdirSync(dirname(path), { recursive: true });
  return new SqliteSphereStore(path);
}

function openAudit(): SqliteAuditSink {
  const path = process.env["KINOS_AUDIT_DB"] ?? "data/audit.sqlite";
  mkdirSync(dirname(path), { recursive: true });
  return new SqliteAuditSink(path);
}

function openApprovals(): SqliteApprovalStore {
  const path = process.env["KINOS_APPROVALS_DB"] ?? "data/approvals.sqlite";
  mkdirSync(dirname(path), { recursive: true });
  return new SqliteApprovalStore(path);
}

function localExecutor(): LocalCapabilityExecutor {
  return new LocalCapabilityExecutor(
    new Map<string, CapabilityHandler>([
      ["local.calendar", async (input) => ({ created: true, input })],
      ["local.pay", async (input) => ({ paid: true, input })],
      ["local.echo", async (input) => ({ echoed: input })],
    ]),
  );
}

async function runMvp(): Promise<number> {
  const report = await runMvpScenario({ runtime: new OllamaRuntime(), now: new Date().toISOString() });
  console.log("KinOS MVP §19 acceptance\n");
  for (const c of report.criteria) {
    console.log(`  ${c.passed ? "PASS" : "FAIL"}  ${c.description} — ${c.detail}`);
  }
  console.log(report.allPassed ? "\nAll §19 criteria passed." : "\nSome §19 criteria failed.");
  return report.allPassed ? 0 : 1;
}

const USAGE =
  "usage: kinos <mvp | init <id> <name> | list | show <id> | export <id> | run <id> <cap> [adult|child] | approve <approvalId> [grant|deny] | audit <correlationId>>";

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "mvp":
      return runMvp();
    case "init": {
      const [id, ...nameParts] = rest;
      if (!id || nameParts.length === 0) {
        console.error("usage: kinos init <id> <name>");
        return 1;
      }
      const store = openStore();
      const audit = openAudit();
      const correlationId = randomUUID();
      try {
        console.log(
          await initSphere(store, {
            id,
            name: nameParts.join(" "),
            founderName: "Administrator",
            now: new Date().toISOString(),
            audit,
            correlationId,
          }),
        );
        console.log(`correlationId: ${correlationId}`);
      } finally {
        store.close();
        audit.close();
      }
      return 0;
    }
    case "list": {
      const store = openStore();
      try {
        console.log(await listSpheres(store));
      } finally {
        store.close();
      }
      return 0;
    }
    case "show": {
      const [id] = rest;
      if (!id) {
        console.error("usage: kinos show <id>");
        return 1;
      }
      const store = openStore();
      try {
        console.log(await showSphere(store, id));
      } finally {
        store.close();
      }
      return 0;
    }
    case "export": {
      const [id] = rest;
      if (!id) {
        console.error("usage: kinos export <id>");
        return 1;
      }
      const store = openStore();
      try {
        console.log(await exportSphereJson(store, id));
      } finally {
        store.close();
      }
      return 0;
    }
    case "run": {
      const [sphereId, capabilityName, profileArg] = rest;
      if (!sphereId || !capabilityName) {
        console.error("usage: kinos run <id> <capability> [adult|child]");
        return 1;
      }
      const profile = profileArg === "child" ? "child" : "adult";
      const store = openStore();
      const audit = openAudit();
      const approvals = openApprovals();
      try {
        console.log(
          await runCapability(
            { store, executor: localExecutor(), audit, approvals, newApprovalId: () => `apr_${randomUUID()}` },
            {
              sphereId,
              capabilityName,
              profile,
              now: new Date().toISOString(),
              correlationId: randomUUID(),
            },
          ),
        );
      } finally {
        store.close();
        audit.close();
        approvals.close();
      }
      return 0;
    }
    case "approve": {
      const [approvalId, decisionArg] = rest;
      if (!approvalId) {
        console.error("usage: kinos approve <approvalId> [grant|deny]");
        return 1;
      }
      const decision = decisionArg === "deny" ? "deny" : "grant";
      const store = openStore();
      const audit = openAudit();
      const approvals = openApprovals();
      try {
        console.log(
          await approveCapability(
            { store, approvals, executor: localExecutor(), audit },
            {
              approvalId,
              decision,
              approverMemberId: "cli-approver",
              approverRole: "parent",
              now: new Date().toISOString(),
            },
          ),
        );
      } finally {
        store.close();
        audit.close();
        approvals.close();
      }
      return 0;
    }
    case "audit": {
      const [correlationId] = rest;
      if (!correlationId) {
        console.error("usage: kinos audit <correlationId>");
        return 1;
      }
      const audit = openAudit();
      try {
        console.log(showAudit(audit, correlationId));
      } finally {
        audit.close();
      }
      return 0;
    }
    default:
      console.error(USAGE);
      return 1;
  }
}

process.exit(await main(process.argv.slice(2)));
