import { describe, expect, it } from "vitest";

import {
  changeModelPreference,
  createAgent,
  disableAgent,
  enableCapability,
} from "./agent.js";
import { createMemoryItem } from "../memory/memory.js";
import { authorizeMemoryRead } from "../memory/resolver.js";
import type { PolicyRequest } from "../policy/types.js";

function personalAgent(over: Partial<Parameters<typeof createAgent>[0]> = {}) {
  return createAgent({
    id: "agt_p1",
    ownerId: "mbr_p1",
    ownerType: "member",
    sphereId: "sph_1",
    name: "Parent 1's agent",
    ...over,
  });
}

describe("Agent creation (domain-model / entity-lifecycle)", () => {
  it("starts configured, with its own identity distinct from the owner", () => {
    const agent = personalAgent();
    expect(agent.state).toBe("configured");
    expect(agent.ownerId).toBe("mbr_p1");
    expect(agent.ownerType).toBe("member");
    expect(agent.id).not.toBe(agent.ownerId); // an agent represents, never *is*, its owner
    expect(agent.enabledCapabilities).toEqual([]);
  });

  it("gives each member a distinct agent (§19 each member can have an agent)", () => {
    const owners = ["mbr_p1", "mbr_p2", "mbr_c1"];
    const agents = owners.map((ownerId, i) =>
      personalAgent({ id: `agt_${i}`, ownerId, name: `${ownerId} agent` }),
    );
    expect(new Set(agents.map((a) => a.ownerId)).size).toBe(3);
    expect(new Set(agents.map((a) => a.id)).size).toBe(3);
  });
});

describe("Agent capabilities", () => {
  it("enables a capability without duplicating it", () => {
    let agent = personalAgent();
    agent = enableCapability(agent, "calendar.create_event");
    agent = enableCapability(agent, "calendar.create_event");
    expect(agent.enabledCapabilities).toEqual(["calendar.create_event"]);
  });
});

describe("Agent lifecycle", () => {
  it("disabling an agent does not delete its owner's memory", () => {
    const agent = personalAgent();
    const note = createMemoryItem({
      id: "mem_1",
      ownerId: "mbr_p1",
      ownerType: "member",
      sphereId: "sph_1",
      content: "owner note",
      source: "manual",
      now: "2026-06-25T10:00:00+00:00",
    });

    const disabled = disableAgent(agent);
    expect(disabled.state).toBe("disabled");

    // Memory is independent of the agent: the owner still reads it.
    const owner: PolicyRequest["subject"] = { memberId: "mbr_p1", role: "parent", ageProfile: "adult" };
    const d = authorizeMemoryRead(owner, note, [], {
      sphereId: "sph_1",
      time: "2026-06-25T10:00:00+00:00",
      correlationId: "cor_1",
    });
    expect(d.effect).toBe("allow");
  });

  it("changing the model preference keeps the same agent identity (boring swap)", () => {
    const agent = changeModelPreference(personalAgent({ modelPreference: "llama3" }), "mistral");
    expect(agent.id).toBe("agt_p1");
    expect(agent.modelPreference).toBe("mistral");
    expect(agent.state).toBe("configured"); // unchanged
  });

  it("does not mutate the input agent", () => {
    const agent = personalAgent();
    enableCapability(agent, "x.y");
    disableAgent(agent);
    expect(agent.enabledCapabilities).toEqual([]);
    expect(agent.state).toBe("configured");
  });
});
