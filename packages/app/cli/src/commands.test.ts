import { describe, expect, it } from "vitest";
import {
  InMemoryAuditSink,
  InMemorySphereStore,
  createSphere,
  exportSphere,
  type CapabilityBinding,
  type CapabilityExecutor,
  type Policy,
} from "@kinos/core";

import {
  initSphere,
  listSpheres,
  showSphere,
  exportSphereJson,
  showAudit,
  runCapability,
} from "./commands.js";

const NOW = "2026-06-25T10:00:00.000Z";

describe("CLI commands over a SphereStore (results-contract §1/§15)", () => {
  it("init persists a Sphere that list and show then read back", async () => {
    const store = new InMemorySphereStore();

    await initSphere(store, { id: "sph_1", name: "Doe Family", founderName: "Parent One", now: NOW });

    expect(await listSpheres(store)).toContain("sph_1");

    const shown = await showSphere(store, "sph_1");
    expect(shown).toContain("Doe Family");
    expect(shown).toContain("members: 1");
  });

  it("show reports a missing Sphere", async () => {
    const store = new InMemorySphereStore();
    expect(await showSphere(store, "nope")).toMatch(/not found/i);
  });

  it("init refuses to overwrite an existing Sphere (deny by default)", async () => {
    const store = new InMemorySphereStore();
    await initSphere(store, { id: "sph_1", name: "First", founderName: "P", now: NOW });
    await expect(
      initSphere(store, { id: "sph_1", name: "Second", founderName: "P", now: NOW }),
    ).rejects.toThrow(/exists/i);
  });

  it("export emits a valid round-trippable snapshot JSON", async () => {
    const store = new InMemorySphereStore();
    await initSphere(store, { id: "sph_1", name: "Doe Family", founderName: "P", now: NOW });
    const json = await exportSphereJson(store, "sph_1");
    const parsed = JSON.parse(json);
    expect(parsed.format).toBe("kinos.sphere.export");
    expect(parsed.sphere.id).toBe("sph_1");
  });

  it("init emits a sphere.created audit event under the given correlation id", async () => {
    const store = new InMemorySphereStore();
    const audit = new InMemoryAuditSink();
    await initSphere(store, {
      id: "sph_1",
      name: "Doe Family",
      founderName: "P",
      now: NOW,
      audit,
      correlationId: "cor_init",
    });
    const chain = audit.byCorrelation("cor_init");
    expect(chain.map((e) => e.type)).toEqual(["sphere.created"]);
    expect(chain[0]?.resourceId).toBe("sph_1");
  });

  // --- runCapability: the governed execute loop over a persisted Sphere ---

  const allowAdultCalendar: Policy = {
    id: "pol_cal",
    sphereId: "sph_1",
    description: "Adults may create calendar events.",
    subjectSelector: { ageProfiles: ["adult"] },
    action: "execute",
    resourceSelector: { capabilityNames: ["calendar.create_event"] },
    effect: "allow",
    priority: 0,
    version: 1,
    status: "active",
  };
  const calendarBinding: CapabilityBinding = {
    capability: "calendar.create_event",
    runtime: "local",
    runtimeToolName: "local.calendar",
    execution: "local",
    risk: "medium",
    requiresApproval: false,
    status: "enabled",
  };

  async function seed(
    store: InMemorySphereStore,
    opts: { policies?: Policy[]; bindings?: CapabilityBinding[] } = {},
  ) {
    const sphere = createSphere({
      id: "sph_1",
      type: "family",
      name: "Doe Family",
      founder: { memberId: "mbr_sph_1_founder", identityId: "idy", role: "parent" },
    });
    await store.save(
      exportSphere({
        sphere,
        identities: [],
        agents: [],
        memory: [],
        policies: opts.policies ?? [],
        bindings: opts.bindings ?? [],
        exportedAt: NOW,
      }),
    );
  }

  function countingExecutor(): CapabilityExecutor & { calls: number } {
    return {
      calls: 0,
      async execute() {
        this.calls += 1;
        return { created: true };
      },
    };
  }

  function runDeps(store: InMemorySphereStore, executor: CapabilityExecutor, audit: InMemoryAuditSink) {
    let n = 0;
    return { store, executor, audit, newApprovalId: () => `apr_${++n}` };
  }

  it("runCapability executes an allowed capability via the executor", async () => {
    const store = new InMemorySphereStore();
    await seed(store, { policies: [allowAdultCalendar], bindings: [calendarBinding] });
    const executor = countingExecutor();
    const audit = new InMemoryAuditSink();

    const out = await runCapability(runDeps(store, executor, audit), {
      sphereId: "sph_1",
      capabilityName: "calendar.create_event",
      profile: "adult",
      now: NOW,
      correlationId: "cor_run",
    });

    expect(out).toContain("outcome: executed");
    expect(executor.calls).toBe(1);
    expect(audit.byCorrelation("cor_run").map((e) => e.type)).toContain("capability.executed");
  });

  it("runCapability denies when the Sphere has no enabled binding", async () => {
    const store = new InMemorySphereStore();
    await seed(store, { policies: [allowAdultCalendar] }); // no bindings
    const executor = countingExecutor();
    const out = await runCapability(runDeps(store, executor, new InMemoryAuditSink()), {
      sphereId: "sph_1",
      capabilityName: "calendar.create_event",
      profile: "adult",
      now: NOW,
      correlationId: "cor_run",
    });
    expect(out).toContain("outcome: denied");
    expect(out).toMatch(/binding/i);
    expect(executor.calls).toBe(0);
  });

  it("runCapability denies a child by the catalog profile floor", async () => {
    const store = new InMemorySphereStore();
    await seed(store, { policies: [{ ...allowAdultCalendar, subjectSelector: {} }], bindings: [calendarBinding] });
    const executor = countingExecutor();
    const out = await runCapability(runDeps(store, executor, new InMemoryAuditSink()), {
      sphereId: "sph_1",
      capabilityName: "calendar.create_event",
      profile: "child",
      now: NOW,
      correlationId: "cor_run",
    });
    expect(out).toContain("outcome: denied");
    expect(out).toMatch(/profile/i);
    expect(executor.calls).toBe(0);
  });

  it("showAudit renders a correlation chain and reports an empty one", () => {
    const audit = new InMemoryAuditSink();
    audit.record({
      type: "sphere.created",
      sphereId: "sph_1",
      resourceType: "sphere",
      resourceId: "sph_1",
      correlationId: "cor_init",
      createdAt: NOW,
    });
    expect(showAudit(audit, "cor_init")).toContain("sphere.created");
    expect(showAudit(audit, "missing")).toMatch(/no audit events/i);
  });
});
