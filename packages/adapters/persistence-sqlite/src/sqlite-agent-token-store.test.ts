import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SqliteAgentTokenStore } from "./sqlite-agent-token-store.js";

let dir: string | undefined;
let store: SqliteAgentTokenStore | undefined;

afterEach(() => {
  store?.close();
  store = undefined;
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function open(): SqliteAgentTokenStore {
  dir = mkdtempSync(join(tmpdir(), "kinos-tok-"));
  store = new SqliteAgentTokenStore(join(dir, "tokens.sqlite"));
  return store;
}

describe("SqliteAgentTokenStore (ADR-007)", () => {
  it("provisions a token that resolves to its owner, and never stores the plaintext", () => {
    const s = open();
    return s.provision("sph_1", "agt_0").then((p) => {
      expect(p.token.length).toBeGreaterThan(20);
      expect(p.record.secretRef).toBe("secret://sphere-mcp/sph_1/agt_0");
      const resolved = s.resolve(p.token);
      expect(resolved).toEqual({ sphereId: "sph_1", agentId: "agt_0", secretRef: p.record.secretRef });
      // An unknown token resolves to nothing (fail closed).
      expect(s.resolve("not-a-token")).toBeUndefined();
      expect(s.resolve("")).toBeUndefined();
    });
  });

  it("rotation keeps the secretRef stable, invalidates the old value", async () => {
    const s = open();
    const first = await s.provision("sph_1", "agt_0");
    const second = await s.rotate("sph_1", "agt_0");
    expect(second.record.secretRef).toBe(first.record.secretRef); // stable id
    expect(second.token).not.toBe(first.token);
    expect(s.resolve(second.token)).toMatchObject({ agentId: "agt_0" });
    expect(s.resolve(first.token)).toBeUndefined(); // old value no longer resolves
  });

  it("revocation denies future resolution immediately", async () => {
    const s = open();
    const p = await s.provision("sph_1", "agt_0");
    await s.revoke("sph_1", "agt_0");
    expect(s.resolve(p.token)).toBeUndefined();
  });

  it("a token resolves only with its exact value (per-Sphere/agent isolation)", async () => {
    const s = open();
    const a = await s.provision("sph_1", "agt_a");
    const b = await s.provision("sph_2", "agt_b");
    expect(s.resolve(a.token)).toMatchObject({ sphereId: "sph_1", agentId: "agt_a" });
    expect(s.resolve(b.token)).toMatchObject({ sphereId: "sph_2", agentId: "agt_b" });
  });
});
