import { describe, expect, it } from "vitest";

import { runChatTurn } from "./chat.js";
import { createSession } from "./session.js";
import { createMemoryItem } from "../memory/memory.js";
import type { AgentRuntime, RuntimeRequest } from "../runtime/runtime.js";
import type { PolicyRequest } from "../policy/types.js";

const NOW = "2026-06-26T10:00:00.000Z";
const owner: PolicyRequest["subject"] = { memberId: "mbr_p1", role: "parent", ageProfile: "adult" };
const other: PolicyRequest["subject"] = { memberId: "mbr_p2", role: "parent", ageProfile: "adult" };

/** Fake runtime: records the last request, returns a canned reply. */
function fakeRuntime(reply = "hello back"): AgentRuntime & { last?: RuntimeRequest } {
  return {
    last: undefined,
    async listModels() {
      return ["test-model"];
    },
    async generate(request: RuntimeRequest) {
      this.last = request;
      return { model: request.model, content: reply };
    },
    async isAvailable() {
      return true;
    },
  };
}

function session(ownerId = "mbr_p1") {
  return createSession({ id: "ses_1", sphereId: "sph_1", agentId: "agt_1", ownerId, now: NOW });
}

const turn = (over: Record<string, unknown> = {}) => ({
  session: session(),
  subject: owner,
  userText: "what's on today?",
  memory: [],
  policies: [],
  model: "test-model",
  now: NOW,
  correlationId: "cor_1",
  userMessageId: "msg_u",
  agentMessageId: "msg_a",
  ...over,
});

describe("runChatTurn (RFC-005)", () => {
  it("appends the user message and the reply, returns the reply", async () => {
    const rt = fakeRuntime("there are 2 events");
    const { session: out, reply } = await runChatTurn({ runtime: rt }, turn());
    expect(reply).toBe("there are 2 events");
    expect(out.messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "what's on today?"],
      ["agent", "there are 2 events"],
    ]);
    // the runtime saw the user text
    expect(rt.last?.messages.at(-1)).toEqual({ role: "user", content: "what's on today?" });
  });

  it("refuses a turn in a session the subject does not own", async () => {
    const rt = fakeRuntime();
    await expect(runChatTurn({ runtime: rt }, turn({ subject: other }))).rejects.toThrow(/not authorized/i);
    expect(rt.last).toBeUndefined(); // never reached the runtime
  });

  it("only sends policy-authorized memory to the runtime (filter before runtime)", async () => {
    const mine = createMemoryItem({
      id: "mem_a",
      ownerId: "mbr_p1",
      ownerType: "member",
      sphereId: "sph_1",
      content: "OWNER_SECRET_A",
      source: "manual",
      now: NOW,
    });
    const theirs = createMemoryItem({
      id: "mem_b",
      ownerId: "mbr_p2",
      ownerType: "member",
      sphereId: "sph_1",
      content: "OTHER_SECRET_B",
      source: "manual",
      now: NOW,
    });
    const rt = fakeRuntime();
    await runChatTurn({ runtime: rt }, turn({ memory: [mine, theirs] }));
    const sent = JSON.stringify(rt.last?.messages);
    expect(sent).toContain("OWNER_SECRET_A"); // owner's memory is authorized
    expect(sent).not.toContain("OTHER_SECRET_B"); // another member's private memory is filtered out
  });

  it("includes prior history in order", async () => {
    const rt = fakeRuntime();
    const s0 = session();
    const first = await runChatTurn({ runtime: rt }, turn({ session: s0, userText: "hi" }));
    await runChatTurn(
      { runtime: rt },
      turn({ session: first.session, userText: "and tomorrow?", userMessageId: "msg_u2", agentMessageId: "msg_a2" }),
    );
    const roles = rt.last?.messages.map((m) => m.role);
    // prior user + assistant, then the new user message
    expect(roles).toEqual(["user", "assistant", "user"]);
  });
});
