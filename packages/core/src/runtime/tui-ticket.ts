/**
 * Harness TUI attach tickets (ADR-008 §6).
 *
 * A ticket is the single-use, short-lived bearer of one authorized decision:
 * "this actor may attach a terminal to this agent's governed Harness profile".
 * It is minted only *after* the Policy Engine has allowed `runtime.session.attach`
 * and redeemed exactly once by the Harness-side bridge, which then spawns the
 * agent's profile on a PTY.
 *
 * Why a ticket rather than passing the subject to the bridge: the bridge must
 * never evaluate authorization (ADR-008 §5 — the Harness is never the governance
 * boundary). It cannot decide anything; it can only present a ticket and be told
 * which profile it may open. A ticket carries no rights of its own beyond that
 * one attachment, and it names an agent — never a filesystem path, so a
 * compromised bridge cannot ask for an arbitrary directory.
 *
 * Deny-by-default throughout: unknown, expired, or already-redeemed tickets are
 * refused. Redemption is single-use so a leaked ticket cannot be replayed, and
 * the TTL is short so an unused one dies on its own.
 *
 * Pure domain: no I/O, no provider/runtime imports. Ticket *values* are minted by
 * an injected generator (the app layer supplies a CSPRNG).
 */

/** How long a minted ticket stays redeemable. Short: it is used immediately. */
export const TUI_TICKET_TTL_SECONDS = 60;

export interface TuiTicket {
  /** The high-entropy secret the bridge presents. Never logged or audited. */
  readonly value: string;
  readonly sphereId: string;
  readonly agentId: string;
  /** ISO timestamp; the ticket is refused at/after this instant. */
  readonly expiresAt: string;
  /** Chains policy check -> ticket -> attach -> Sphere MCP calls. */
  readonly correlationId: string;
}

export interface RedeemedTicket {
  readonly sphereId: string;
  readonly agentId: string;
  readonly correlationId: string;
}

export interface CreateTuiTicketInput {
  readonly value: string;
  readonly sphereId: string;
  readonly agentId: string;
  readonly correlationId: string;
  /** Current time (ISO); the expiry is derived from it. */
  readonly now: string;
  readonly ttlSeconds?: number;
}

export function createTuiTicket(input: CreateTuiTicketInput): TuiTicket {
  if (input.value.trim() === "") throw new Error("A TUI ticket requires a value");
  const ttl = input.ttlSeconds ?? TUI_TICKET_TTL_SECONDS;
  const expiresAt = new Date(new Date(input.now).getTime() + ttl * 1000).toISOString();
  return {
    value: input.value,
    sphereId: input.sphereId,
    agentId: input.agentId,
    correlationId: input.correlationId,
    expiresAt,
  };
}

/**
 * Single-use ticket store. In-memory by design: a ticket is redeemed seconds
 * after minting, and nothing of value is lost by forgetting it on restart —
 * unlike memory or policy, an attach ticket is not a durable fact.
 */
export class TuiTicketStore {
  private readonly tickets = new Map<string, TuiTicket>();

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  issue(ticket: TuiTicket): void {
    this.tickets.set(ticket.value, ticket);
  }

  /**
   * Redeem a ticket, consuming it. Returns undefined for an unknown, expired or
   * already-redeemed ticket — the caller must treat that as a refusal, never as
   * a reason to guess a profile (coding principle 6).
   */
  redeem(value: string): RedeemedTicket | undefined {
    const ticket = this.tickets.get(value);
    if (ticket === undefined) return undefined;
    // Consume first: a replay of the same value must fail even if it is expired.
    this.tickets.delete(value);
    if (Date.parse(ticket.expiresAt) <= Date.parse(this.now())) return undefined;
    return { sphereId: ticket.sphereId, agentId: ticket.agentId, correlationId: ticket.correlationId };
  }

  /** Drop expired tickets so an abandoned mint does not accumulate. */
  prune(): void {
    const now = Date.parse(this.now());
    for (const [value, ticket] of this.tickets) {
      if (Date.parse(ticket.expiresAt) <= now) this.tickets.delete(value);
    }
  }
}
