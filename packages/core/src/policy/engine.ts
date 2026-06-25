/**
 * Policy Engine — the single authorization authority (ADR-003).
 *
 * Deterministic and side-effect free: given the same request and the same
 * active policy set it always returns the same decision. It never calls a model.
 *
 * Fixed precedence (cannot be reordered by priority):
 *   deny  >  require_approval  >  allow ,  and absence of an allow = deny.
 *
 * Pure domain: no provider/runtime imports, no I/O.
 *
 * Scope note: the `subjectSelector.agents` (personal/sphere) selector and the
 * `contextConditions.maxCostCents` ceiling are not evaluated yet — they are
 * deferred to later slices. Until then a policy that sets `agents` to a
 * specific kind does not match (conservative, deny-by-default), and a cost
 * ceiling is ignored. No §19 criterion depends on either.
 */

import {
  DEFAULT_APPROVAL_EXPIRY_SECONDS,
  type Classification,
  type Policy,
  type PolicyDecision,
  type PolicyRequest,
  type TimeWindow,
} from "./types.js";

const DENY_DEFAULT_REASON =
  "No active policy grants this request; denied by default.";
const DENY_UNRESOLVED_SUBJECT_REASON =
  "Subject role or age profile could not be resolved; denied by default.";

export function evaluate(
  request: PolicyRequest,
  policies: readonly Policy[],
): PolicyDecision {
  const correlationId = request.context.correlationId;

  // Stage 1: resolve identity. Missing role/age profile fails closed.
  if (!request.subject.role || !request.subject.ageProfile) {
    return { effect: "deny", reason: DENY_UNRESOLVED_SUBJECT_REASON, correlationId };
  }

  // Stages 3: select matching active policies (stage 2 normalization folded in
  // via effectiveClassification during resource matching).
  const matching = policies.filter(
    (p) => p.status === "active" && matches(p, request),
  );

  // Stage 4: explicit deny wins.
  const deny = pickWinner(matching, "deny");
  if (deny) {
    return {
      effect: "deny",
      reason: deny.description,
      matchedPolicyId: deny.id,
      matchedPolicyVersion: deny.version,
      correlationId,
    };
  }

  // Stage 5: approval beats allow.
  const approval = pickWinner(matching, "require_approval");
  if (approval) {
    return {
      effect: "require_approval",
      reason: approval.description,
      matchedPolicyId: approval.id,
      matchedPolicyVersion: approval.version,
      approval: {
        approverRoles: approval.approverRoles ?? [],
        expiresInSeconds: DEFAULT_APPROVAL_EXPIRY_SECONDS,
      },
      correlationId,
    };
  }

  // Stage 6: allow only if explicitly granted.
  const allow = pickWinner(matching, "allow");
  if (allow) {
    return {
      effect: "allow",
      reason: allow.description,
      matchedPolicyId: allow.id,
      matchedPolicyVersion: allow.version,
      correlationId,
    };
  }

  // Stage 7: default deny.
  return { effect: "deny", reason: DENY_DEFAULT_REASON, correlationId };
}

/**
 * Among policies of one effect class, choose the one cited in the reason:
 * highest priority, then most specific selector. This never changes the effect
 * chosen by the staged order — only which policy is named.
 */
function pickWinner(matching: readonly Policy[], effect: Policy["effect"]): Policy | undefined {
  const candidates = matching.filter((p) => p.effect === effect);
  if (candidates.length === 0) return undefined;
  return candidates.reduce((best, p) => {
    if (p.priority !== best.priority) return p.priority > best.priority ? p : best;
    return specificity(p) > specificity(best) ? p : best;
  });
}

function specificity(p: Policy): number {
  const s = p.subjectSelector;
  const r = p.resourceSelector;
  const c = p.contextConditions ?? {};
  const fields = [
    s.roles,
    s.ageProfiles,
    s.memberIds,
    s.agents,
    r.types,
    r.capabilityNames,
    r.classifications,
    r.sensitivities,
    r.riskLevels,
    c.timeWindows,
    c.execution,
    c.maxCostCents,
  ];
  let count = fields.filter((f) => f !== undefined).length;
  if (p.action !== "any") count += 1;
  return count;
}

function matches(p: Policy, req: PolicyRequest): boolean {
  return (
    actionMatches(p, req) &&
    subjectMatches(p, req) &&
    resourceMatches(p, req) &&
    contextMatches(p, req)
  );
}

function actionMatches(p: Policy, req: PolicyRequest): boolean {
  return p.action === "any" || p.action === req.action;
}

function subjectMatches(p: Policy, req: PolicyRequest): boolean {
  const s = p.subjectSelector;
  if (s.roles && !s.roles.includes(req.subject.role)) return false;
  if (s.ageProfiles && !s.ageProfiles.includes(req.subject.ageProfile)) return false;
  if (s.memberIds) {
    if (req.subject.memberId === undefined || !s.memberIds.includes(req.subject.memberId)) {
      return false;
    }
  }
  // Deferred: a specific agent-kind selector cannot be confirmed yet → no match.
  if (s.agents !== undefined && s.agents !== "any") return false;
  return true;
}

function resourceMatches(p: Policy, req: PolicyRequest): boolean {
  const r = p.resourceSelector;
  const res = req.resource;
  if (r.types && !r.types.includes(res.type)) return false;
  if (r.capabilityNames) {
    if (res.capabilityName === undefined || !capabilityMatches(res.capabilityName, r.capabilityNames)) {
      return false;
    }
  }
  if (r.classifications) {
    // Stage 2: an unclassified resource is treated as the most restrictive,
    // `private`, before evaluation.
    const effective: Classification = res.classification ?? "private";
    if (!r.classifications.includes(effective)) return false;
  }
  if (r.sensitivities) {
    if (res.sensitivity === undefined || !r.sensitivities.includes(res.sensitivity)) return false;
  }
  if (r.riskLevels) {
    if (res.riskLevel === undefined || !r.riskLevels.includes(res.riskLevel)) return false;
  }
  return true;
}

function capabilityMatches(name: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith(".*")) {
      const prefix = pattern.slice(0, -1); // keep trailing dot, e.g. "message."
      return name.startsWith(prefix);
    }
    return name === pattern;
  });
}

function contextMatches(p: Policy, req: PolicyRequest): boolean {
  const c = p.contextConditions;
  if (!c) return true;
  if (c.execution !== undefined && c.execution !== req.context.execution) return false;
  if (c.timeWindows) {
    const minutes = minutesOfDay(req.context.time);
    if (!c.timeWindows.some((w) => windowContains(w, minutes))) return false;
  }
  // maxCostCents deferred (see file header).
  return true;
}

function windowContains(w: TimeWindow, minutes: number): boolean {
  if (w.after !== undefined && minutes < toMinutes(w.after)) return false;
  if (w.before !== undefined && minutes >= toMinutes(w.before)) return false;
  return true;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

/** Wall-clock minutes-of-day from an ISO timestamp's time portion. */
function minutesOfDay(iso: string): number {
  const t = iso.indexOf("T");
  if (t === -1) throw new Error(`Malformed timestamp: ${iso}`);
  const time = iso.slice(t + 1);
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}
