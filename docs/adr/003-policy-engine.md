# ADR-003 — Policy Engine

## Status

Accepted for MVP.

## Context

KinOS handles personal agents, Sphere agents, private memory, shared memory, minors, integrations and external actions. Safety cannot be delegated to prompts or models.

The Policy Engine is the single authority for authorization in KinOS. It decides, for every governed request, whether the request is allowed, denied or must wait for human approval. Nothing downstream — runtime, model, integration, prompt — may re-grant what the Policy Engine denied, and nothing may bypass it.

## Decision

KinOS uses a dedicated Policy Engine as the authority for access control, capability execution and approval requirements.

The Policy Engine is deterministic, side-effect free during evaluation, and explainable. Given the same request and the same active policy set, it always returns the same decision. It never calls a model to decide. A model may phrase a denial, but never produce one.

## Pipeline position

The Policy Engine sits between identity and everything that touches data or tools:

```text
User
  -> Identity Resolver      (who is asking, in which Sphere, with which role/age profile)
  -> Policy Engine          (allow / deny / require_approval, with reasons)
  -> Memory Resolver        (retrieves only memory the Policy Engine authorized)
  -> Capability Resolver    (exposes only capabilities the Policy Engine authorized)
  -> Agent Runtime          (executes; never decides)
  -> Tool / MCP / Integration
```

The Memory Resolver and Capability Resolver are consumers of Policy Engine decisions, not independent gatekeepers. The runtime receives only an already-filtered context and an already-filtered capability list. The runtime is a second line of defense, never the first.

The Policy Engine is consulted at least twice in a typical request:

1. Context assembly — to scope memory retrieval and the offered capability set before the runtime is invoked.
2. Action authorization — when an agent requests a specific capability execution, before the binding runs.

## Request model

A policy request is the unit the engine evaluates:

```ts
type PolicyRequest = {
  subject: {
    memberId?: string;        // human actor, if any
    agentId?: string;         // acting agent
    role: string;             // role in this Sphere: parent | teenager | child | guest | admin | ...
    ageProfile: 'adult' | 'teen' | 'child';
    onBehalfOf?: string;      // memberId an agent represents
  };
  action: 'read' | 'write' | 'share' | 'revoke' | 'execute' | 'approve' | 'export' | 'enable' | 'disable';
  resource: {
    type: 'memory' | 'capability' | 'integration' | 'document' | 'sphere' | 'approval';
    id?: string;
    classification?: 'private' | 'shared_with_members' | 'shared_with_supervisors'
                   | 'shared_with_sphere' | 'public_exportable';
    sensitivity?: 'normal' | 'sensitive' | 'medical' | 'financial' | 'legal';
    capabilityName?: string;  // e.g. calendar.create_event
    riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  };
  context: {
    sphereId: string;
    time: string;             // ISO timestamp, used for time-window conditions
    execution: 'local' | 'cloud';
    estimatedCostCents?: number;
    correlationId: string;
  };
};
```

A policy decision is the result:

```ts
type PolicyDecision = {
  effect: 'allow' | 'deny' | 'require_approval';
  reason: string;             // user-safe, references the deciding policy
  matchedPolicyId?: string;
  matchedPolicyVersion?: number;
  approval?: {
    approverRoles: string[];  // who may approve, e.g. ['parent']
    expiresInSeconds: number;
  };
  correlationId: string;
};
```

## Policy structure

A Policy follows the domain model (`docs/domain/domain-model.md`) and compiles to an evaluable rule:

```ts
type Policy = {
  id: string;
  sphereId: string;
  description: string;          // human-readable source rule
  subjectSelector: {            // who this policy applies to
    roles?: string[];
    ageProfiles?: Array<'adult' | 'teen' | 'child'>;
    memberIds?: string[];
    agents?: 'personal' | 'sphere' | 'any';
  };
  action: PolicyRequest['action'] | 'any';
  resourceSelector: {           // what this policy applies to
    types?: Array<PolicyRequest['resource']['type']>;
    capabilityNames?: string[]; // exact or prefix, e.g. 'message.*'
    classifications?: string[];
    sensitivities?: string[];
    riskLevels?: string[];
  };
  contextConditions?: {         // when this policy applies
    timeWindows?: Array<{ after?: string; before?: string }>; // local HH:MM
    execution?: 'local' | 'cloud';
    maxCostCents?: number;
  };
  effect: 'allow' | 'deny' | 'require_approval';
  approverRoles?: string[];     // required when effect = require_approval
  priority: number;             // higher wins among same effect class; see conflict resolution
  version: number;
  status: 'draft' | 'test' | 'active' | 'disabled' | 'superseded' | 'archived';
};
```

A selector that omits a field matches any value for that field. An empty `subjectSelector` matches every subject. This makes broad defaults easy and narrow exceptions explicit.

## Effects

- `allow` — the request proceeds.
- `deny` — the request is refused. A denial is terminal and explainable.
- `require_approval` — the request is suspended until a human with an authorized role approves it. An unanswered approval expires and resolves as a denial.

`require_approval` is not a softer `allow`. Until approval is granted, the action does not happen. An expired or denied approval is a denial.

## Deny-by-default semantics

If no active policy produces an `allow` for a request, the result is `deny`. Specifically:

- missing policy → deny;
- missing or unresolved role/age profile → deny;
- unknown capability name → deny;
- unclassified resource → treated as `private` / highest sensitivity, then evaluated;
- malformed request → deny;
- engine error or timeout → deny (fail closed).

Silence is never consent. The engine never guesses an allow.

## Evaluation order and conflict resolution

Evaluation is staged. Earlier stages dominate later ones.

1. Resolve identity, Sphere, role and age profile. If any is missing → `deny`.
2. Resolve resource classification and sensitivity. Unclassified → most restrictive.
3. Select all `active` policies whose selectors and context conditions match the request.
4. **Explicit deny wins.** If any matching policy has effect `deny`, the result is `deny`. Deny is never overridden by an allow, regardless of priority. This is the safety floor.
5. **Approval beats allow.** If no deny matched and any matching policy has effect `require_approval`, the result is `require_approval`. A required approval is never silently downgraded to allow.
6. **Allow only if explicitly granted.** If the only matching policies are `allow`, the result is `allow`.
7. **Default deny.** If nothing matched, the result is `deny`.

Within a single effect class (e.g. two `require_approval` policies), `priority` and then most-specific selector decide which policy is cited as `matchedPolicyId`. Conflict resolution never changes the effect chosen by the staged order above; it only chooses which policy is named in the reason. `deny > require_approval > allow` is a fixed precedence and cannot be reordered by priority.

Minor-protection policies and external-transfer policies are seeded as high-priority `deny` / `require_approval` defaults so that absence of an explicit allow keeps minors and external transfers restricted.

## Context conditions

Conditions narrow when a policy applies:

- **role / age profile** — the primary axis; child, teen, adult, parent, admin, guest.
- **time window** — local `after` / `before`, e.g. deny entertainment capabilities after 22:00 for child profiles.
- **risk level** — escalate approval for `high` / `critical` capabilities.
- **estimated cost** — require approval above a Sphere-defined cost ceiling.
- **execution local vs cloud** — cloud execution can require additional consent even when the local equivalent is allowed.
- **minor status** — child and teen profiles carry restricted defaults that an explicit allow must override.

Conditions are AND-combined: every present condition must hold for the policy to match.

## Natural-language rule compilation

Administrators write readable rules. KinOS compiles them into the structured `Policy` form above; it does not store prose as the executable rule.

Flow: draft text → parsed candidate `Policy` (selectors, action, effect, conditions) → preview shown back to the admin in plain language → admin confirms → policy enters lifecycle.

Constraints:

- The compiler proposes; the human confirms. Compilation never auto-activates a policy.
- If the text is ambiguous, the compiler must surface the ambiguity and refuse to guess a broad `allow`. Ambiguity resolves toward the more restrictive interpretation.
- The compiled structured policy — not the original sentence — is what the engine evaluates. The sentence is retained as `description` for audit and display.
- The compiler may use a model to parse language, but the model never grants authorization; it only proposes structure a human approves. This keeps the invariant "policies do not live in prompts" intact.

Example: "Kids can't message people outside the family after 9pm" compiles to a policy with `subjectSelector.ageProfiles = ['child']`, `resourceSelector.capabilityNames = ['message.send']`, `contextConditions.timeWindows = [{ after: '21:00' }]`, `effect = 'deny'`.

## Policy lifecycle

Policies move through `draft → test → active → (superseded | disabled | archived)`, matching `docs/domain/entity-lifecycle.md`.

- **draft** — editable, never evaluated against live requests.
- **test** — evaluated only against simulated or replayed requests in a sandbox; produces a decision report but never affects real actions. Used to preview impact before activation.
- **active** — versioned and live. Editing an active policy creates a new version; the prior version becomes `superseded`. Activation and supersession emit audit events.
- **disabled** — removed from evaluation; can be re-activated.
- **archived** — retained for audit history only.

Activation is explicit. A policy is never silently promoted from draft or test to active.

## Correlation-id threading

Every governed request carries a `correlationId` generated at request entry. The same id threads through:

```text
policy check -> approval request -> runtime call -> integration call -> audit events
```

This lets an auditor reconstruct a single chain: which subject, which policy version decided, whether an approval was raised and by whom it was answered, which capability ran and which integration executed it. Audit events record these facts and the deciding policy id/version, not the private content of the action (see `docs/architecture/event-model.md`).

## Worked examples

### 1. Child vs parent — read private adult memory

Child agent requests `read` on a memory item classified `private`, owned by a parent.

- Stage 1–2 resolve: subject role `child`, resource `private`, not owned by or shared with the child.
- No `allow` policy grants a child access to another member's private memory.
- Default deny applies.
- Decision: `deny`, reason "private memory is readable only by its owner unless explicitly shared".

A parent requesting `read` on their own `private` memory matches an ownership allow → `allow`.

### 2. Payment requires approval

Adult agent requests `execute` of `payment.execute` (risk `critical`).

- A high-priority `require_approval` policy matches all `critical` financial capabilities.
- No deny matched.
- Decision: `require_approval`, approverRoles `['parent']` (or Sphere admins), expiry set.
- The action does not run until a human approves. Approval, runtime call and integration call share the correlation id.

### 3. Medical stays private

Sphere agent requests `read` on a memory item with sensitivity `medical`, classified `private`.

- Medical sensitivity carries a restrictive default.
- No policy shares this item with the Sphere agent.
- Decision: `deny`, reason "medical memory is private and not shared with the Sphere agent". Supervision does not imply access to private medical content (supervision ≠ surveillance).

### 4. After-22h rule

Child agent requests `execute` of an entertainment capability at 22:30 local.

- A policy matches `ageProfiles: ['child']`, the capability, and `contextConditions.timeWindows: [{ after: '22:00' }]`, effect `deny`.
- Even if a daytime `allow` policy exists, deny wins by precedence.
- Decision: `deny`, reason "child entertainment capabilities are blocked after 22:00".

Before 22:00 the time-windowed deny does not match, the daytime allow applies → `allow`.

### 5. Cloud execution consent

Adult agent requests a capability whose binding runs `cloud` while a local binding also exists.

- An `allow` covers local execution.
- A `require_approval` policy matches `contextConditions.execution = 'cloud'`.
- Approval beats allow → `require_approval`, citing cloud transfer consent, until the member consents (and an external-transfer record is created per the privacy model).

## Consequences

- No permission logic in prompts; the model never decides authorization.
- No direct MCP/tool/integration call without policy evaluation.
- No default access to memory, capabilities or integrations.
- Every denial and every approval requirement is explainable and cites a policy version.
- Deny strictly dominates allow; approval strictly dominates allow; defaults fail closed.
- The same correlation id chains policy → approval → runtime → integration → audit.
```