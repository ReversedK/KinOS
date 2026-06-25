# KinOS — Capability Catalog

## Purpose

Capabilities are the stable internal API between KinOS domain logic, agents, runtimes and integrations.

Agents request capabilities. They do not request raw MCP tools, n8n workflows or provider APIs.

## Capability schema

Each capability must define:

- name;
- description;
- risk level;
- allowed subject profiles;
- input schema;
- output schema;
- approval requirements;
- audit requirements;
- possible implementations.

## Risk levels

- low: read-only or internal action;
- medium: modifies internal state;
- high: external action, message, publication, purchase or deletion;
- critical: legal, financial, health, safety or irreversible action.

## Initial capabilities

### memory.search

Search authorized memory.

Risk: low.

### memory.write

Create a memory item.

Risk: medium.

### memory.share

Share a memory item with a member or Sphere.

Risk: high.

### memory.revoke

Revoke shared access to a memory item.

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

Send an external message.

Risk: high.

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

Run an approved n8n workflow through a controlled binding.

Risk: depends on workflow.

## Forbidden MVP capabilities for minors by default

- unrestricted_browser.open;
- terminal.execute;
- file.delete;
- payment.execute;
- message.send_external;
- public.publish;
- unknown_tool.execute.
