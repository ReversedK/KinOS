import { describe, expect, it } from "vitest";

import { evaluate } from "./engine.js";
import type { Policy, PolicyRequest } from "./types.js";

// Grounds ADR-003 (Policy Engine): deterministic, deny-by-default, fixed
// precedence deny > require_approval > allow. Worked examples 1, 2, 4, 5.

function baseRequest(over: Partial<PolicyRequest> = {}): PolicyRequest {
  return {
    subject: { role: "parent", ageProfile: "adult" },
    action: "execute",
    resource: { type: "capability", capabilityName: "calendar.create_event", riskLevel: "low" },
    context: {
      sphereId: "sph_1",
      time: "2026-06-25T10:00:00+00:00",
      execution: "local",
      correlationId: "cor_1",
    },
    ...over,
  };
}

function policy(over: Partial<Policy>): Policy {
  return {
    id: "pol_x",
    sphereId: "sph_1",
    description: "test policy",
    subjectSelector: {},
    action: "any",
    resourceSelector: {},
    effect: "allow",
    priority: 0,
    version: 1,
    status: "active",
    ...over,
  };
}

describe("Policy Engine — deny by default", () => {
  it("denies when no policy matches", () => {
    const d = evaluate(baseRequest(), []);
    expect(d.effect).toBe("deny");
    expect(d.correlationId).toBe("cor_1");
  });

  it("denies when the role is missing (unresolved subject)", () => {
    const req = baseRequest({ subject: { role: "", ageProfile: "adult" } });
    expect(evaluate(req, [policy({ effect: "allow" })]).effect).toBe("deny");
  });

  it("ignores non-active policies", () => {
    const draft = policy({ effect: "allow", status: "draft" });
    expect(evaluate(baseRequest(), [draft]).effect).toBe("deny");
  });
});

describe("Policy Engine — precedence deny > require_approval > allow", () => {
  it("allows when only an allow matches", () => {
    const d = evaluate(baseRequest(), [policy({ id: "pol_allow", effect: "allow" })]);
    expect(d.effect).toBe("allow");
    expect(d.matchedPolicyId).toBe("pol_allow");
    expect(d.matchedPolicyVersion).toBe(1);
  });

  it("lets deny dominate allow regardless of priority", () => {
    const allow = policy({ id: "pol_allow", effect: "allow", priority: 100 });
    const deny = policy({ id: "pol_deny", effect: "deny", priority: 1 });
    const d = evaluate(baseRequest(), [allow, deny]);
    expect(d.effect).toBe("deny");
    expect(d.matchedPolicyId).toBe("pol_deny");
  });

  it("lets require_approval beat allow", () => {
    const allow = policy({ id: "pol_allow", effect: "allow" });
    const appr = policy({
      id: "pol_appr",
      effect: "require_approval",
      approverRoles: ["parent"],
    });
    const d = evaluate(baseRequest(), [allow, appr]);
    expect(d.effect).toBe("require_approval");
    expect(d.matchedPolicyId).toBe("pol_appr");
    expect(d.approval?.approverRoles).toEqual(["parent"]);
    expect(d.approval?.expiresInSeconds).toBeGreaterThan(0);
  });
});

describe("Policy Engine — §19 capability allowed for adult, denied for child", () => {
  const adultAllow = policy({
    id: "pol_adult_calendar",
    effect: "allow",
    subjectSelector: { ageProfiles: ["adult"] },
    action: "execute",
    resourceSelector: { types: ["capability"], capabilityNames: ["calendar.create_event"] },
  });

  it("allows the adult", () => {
    expect(evaluate(baseRequest(), [adultAllow]).effect).toBe("allow");
  });

  it("denies the child by default (no allow targets the child)", () => {
    const childReq = baseRequest({ subject: { role: "child", ageProfile: "child" } });
    expect(evaluate(childReq, [adultAllow]).effect).toBe("deny");
  });
});

describe("Policy Engine — capability prefix matching", () => {
  it("matches a prefix pattern message.*", () => {
    const p = policy({
      effect: "allow",
      resourceSelector: { capabilityNames: ["message.*"] },
    });
    const req = baseRequest({
      resource: { type: "capability", capabilityName: "message.send" },
    });
    expect(evaluate(req, [p]).effect).toBe("allow");
  });

  it("does not match a different namespace", () => {
    const p = policy({ effect: "allow", resourceSelector: { capabilityNames: ["message.*"] } });
    const req = baseRequest({ resource: { type: "capability", capabilityName: "payment.execute" } });
    expect(evaluate(req, [p]).effect).toBe("deny");
  });
});

describe("Policy Engine — ADR example 4: after-22:00 child rule", () => {
  const dayAllow = policy({
    id: "pol_day_allow",
    effect: "allow",
    subjectSelector: { ageProfiles: ["child"] },
    resourceSelector: { capabilityNames: ["media.play"] },
  });
  const nightDeny = policy({
    id: "pol_night_deny",
    effect: "deny",
    subjectSelector: { ageProfiles: ["child"] },
    resourceSelector: { capabilityNames: ["media.play"] },
    contextConditions: { timeWindows: [{ after: "22:00" }] },
  });

  function childMediaAt(time: string): PolicyRequest {
    return baseRequest({
      subject: { role: "child", ageProfile: "child" },
      resource: { type: "capability", capabilityName: "media.play" },
      context: { sphereId: "sph_1", time, execution: "local", correlationId: "cor_t" },
    });
  }

  it("denies at 22:30 (deny window matches and dominates the daytime allow)", () => {
    expect(evaluate(childMediaAt("2026-06-25T22:30:00+00:00"), [dayAllow, nightDeny]).effect).toBe(
      "deny",
    );
  });

  it("allows at 20:00 (deny window does not match)", () => {
    expect(evaluate(childMediaAt("2026-06-25T20:00:00+00:00"), [dayAllow, nightDeny]).effect).toBe(
      "allow",
    );
  });
});

describe("Policy Engine — ADR example 5: cloud execution consent", () => {
  it("requires approval for cloud execution even when local is allowed", () => {
    const localAllow = policy({ id: "pol_local", effect: "allow" });
    const cloudAppr = policy({
      id: "pol_cloud",
      effect: "require_approval",
      approverRoles: ["parent"],
      contextConditions: { execution: "cloud" },
    });
    const cloudReq = baseRequest({
      context: { sphereId: "sph_1", time: "2026-06-25T10:00:00+00:00", execution: "cloud", correlationId: "cor_c" },
    });
    expect(evaluate(cloudReq, [localAllow, cloudAppr]).effect).toBe("require_approval");
    // local execution still just allows
    expect(evaluate(baseRequest(), [localAllow, cloudAppr]).effect).toBe("allow");
  });
});
