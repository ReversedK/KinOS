# KinOS — Capability Catalog

## Purpose

Capabilities are the stable internal API between KinOS domain logic, agents, runtimes and integrations.

Agents request capabilities. They do not request raw MCP tools, n8n workflows or provider APIs.

## Capability schema

Each capability must define:

- name (lowercase-dotted, stable; the agent-facing identifier);
- description;
- risk level;
- allowed subject profiles (default-deny: a profile not listed is denied);
- input schema;
- output schema;
- approval requirements (whether a policy floor of require_approval applies);
- audit requirements (which facts must be recorded, never private content);
- possible implementations (bindings; provider names live in adapters, not here).

The catalog declares defaults and floors. It does not override the Policy Engine: a Sphere policy may restrict further, and deny/require_approval from policy always dominates a catalog default. The catalog never widens access on its own.

```ts
type Capability = {
  name: string;                 // e.g. 'calendar.create_event'
  description: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
  allowedProfiles: Array<'adult' | 'teen' | 'child'>; // default-deny outside this set
  inputSchema: object;
  outputSchema: object;
  approvalFloor: boolean;       // policy may raise; runtime may never lower
  auditFacts: string[];         // metadata to record, not content
};
```

## Risk levels

- low: read-only or internal action;
- medium: modifies internal state;
- high: external action, message, publication, purchase or deletion;
- critical: legal, financial, health, safety or irreversible action.

## Subject-profile defaults

- **child**: read-only/internal capabilities only by default; no external action, no external messaging, no publication, no purchase, no deletion.
- **teen**: more autonomy than child but supervisable; high-risk external actions require approval by default.
- **adult**: medium-risk allowed; high and critical risk gated by policy/approval.

A profile absent from a capability's `allowedProfiles` is denied for that capability regardless of other policies (deny by default).

## Initial capabilities

### memory.search

Search authorized memory.

Risk: low.

### memory.write

Create a memory item.

Risk: medium.

### memory.share

Share a memory item with a member or Sphere. Requires explicit consent from the owner; widens visibility but never transfers ownership.

Risk: high. Child: denied by default.

### memory.revoke

Revoke shared access to a memory item. Blocks future access; the prior grant is retained as an audit fact.

Risk: high.

### sphere.note.create

Create a shared Sphere note.

Risk: medium.

### sphere.project.create

Create a shared project in a Sphere.

Risk: medium.

### calendar.read

Read authorized calendars.

Risk: low.

### calendar.create_event

Create a calendar event.

Risk: medium.

### message.draft

Draft an external message without sending it.

Risk: medium.

### message.send

Send an external message. External transfer; subject to external-transfer evaluation and audit.

Risk: high. Child: denied by default. Teen: requires approval by default.

### document.search

Search authorized documents.

Risk: low.

### document.summarize

Summarize an authorized document.

Risk: low to medium depending on sensitivity.

### approval.request

Ask a human approver to validate an action.

Risk: low.

### integration.enable

Enable an integration for a Sphere.

Risk: high.

### integration.disable

Disable an integration for a Sphere.

Risk: high.

### n8n.workflow.run

Run an approved n8n workflow through a controlled binding. The workflow is reached only via a Capability Binding; n8n never evaluates permissions. The capability's risk and approval floor are declared on the binding, not inferred from the workflow.

Risk: depends on workflow (declared per binding).

## Forbidden MVP capabilities for minors by default

These are denied for child profiles by default and require explicit, audited authorization to enable for teens. Absence of an explicit allow keeps them denied.

- unrestricted_browser.open;
- terminal.execute;
- file.delete;
- payment.execute;
- message.send;
- public.publish;
- unknown_tool.execute.

An unknown capability name (not in the catalog) is always denied, for any profile. The system refuses rather than guesses.

## Acceptance criteria for a new capability

A capability is acceptable only if it:

- has a stable lowercase-dotted name and a clear description;
- declares a risk level and the profiles allowed by default (default-deny otherwise);
- declares input and output schemas;
- declares an approval floor and the audit facts to record (metadata, not private content);
- is reachable only through Capability Bindings (no raw tool/API exposure);
- is enforced by the Policy Engine before execution, not by a prompt.
