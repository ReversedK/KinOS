import { describe, expect, it } from "vitest";

import { TUI_TICKET_TTL_SECONDS, TuiTicketStore, createTuiTicket } from "./tui-ticket.js";

const NOW = "2026-07-15T10:00:00.000Z";
const at = (secondsFromNow: number): string => new Date(Date.parse(NOW) + secondsFromNow * 1000).toISOString();

function ticket(overrides: Partial<Parameters<typeof createTuiTicket>[0]> = {}) {
  return createTuiTicket({
    value: "tkt_secret",
    sphereId: "sph_1",
    agentId: "agt_0",
    correlationId: "cor_1",
    now: NOW,
    ...overrides,
  });
}

describe("TUI attach ticket (ADR-008 §6)", () => {
  it("expires TTL seconds after minting", () => {
    expect(ticket().expiresAt).toBe(at(TUI_TICKET_TTL_SECONDS));
  });

  it("refuses an empty value", () => {
    expect(() => ticket({ value: "  " })).toThrow(/requires a value/);
  });

  it("redeems once, returning the agent it authorizes", () => {
    const store = new TuiTicketStore(() => NOW);
    store.issue(ticket());
    expect(store.redeem("tkt_secret")).toEqual({ sphereId: "sph_1", agentId: "agt_0", correlationId: "cor_1" });
  });

  it("refuses a replay of an already-redeemed ticket (single use)", () => {
    const store = new TuiTicketStore(() => NOW);
    store.issue(ticket());
    store.redeem("tkt_secret");
    expect(store.redeem("tkt_secret")).toBeUndefined();
  });

  it("refuses an unknown ticket (deny by default)", () => {
    const store = new TuiTicketStore(() => NOW);
    expect(store.redeem("tkt_never_issued")).toBeUndefined();
  });

  it("refuses an expired ticket and consumes it so it cannot be replayed", () => {
    let clock = NOW;
    const store = new TuiTicketStore(() => clock);
    store.issue(ticket());
    clock = at(TUI_TICKET_TTL_SECONDS + 1);
    expect(store.redeem("tkt_secret")).toBeUndefined();
    clock = NOW; // even if the clock went backwards, the value is gone
    expect(store.redeem("tkt_secret")).toBeUndefined();
  });

  it("refuses a ticket exactly at its expiry instant (boundary is closed)", () => {
    let clock = NOW;
    const store = new TuiTicketStore(() => clock);
    store.issue(ticket());
    clock = at(TUI_TICKET_TTL_SECONDS);
    expect(store.redeem("tkt_secret")).toBeUndefined();
  });

  it("prunes expired tickets without touching live ones", () => {
    let clock = NOW;
    const store = new TuiTicketStore(() => clock);
    store.issue(ticket({ value: "old" }));
    clock = at(30);
    store.issue(ticket({ value: "fresh", now: clock }));
    clock = at(TUI_TICKET_TTL_SECONDS + 1);
    store.prune();
    expect(store.redeem("old")).toBeUndefined();
    expect(store.redeem("fresh")).toMatchObject({ agentId: "agt_0" });
  });
});
