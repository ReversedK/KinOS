/**
 * Secret store (RFC-019) — resolves an integration's `secretRef` to real
 * credentials at execution time for **non-OAuth** providers (Basic auth, api-key,
 * app-specific passwords). OAuth providers resolve their reference through the
 * Better Auth broker instead (RFC-018) and never touch this store.
 *
 * The invariant is credentials-by-reference, never value: the sealed material lives
 * only here. `Integration.secretRef` carries an opaque reference (`secret://…`); the
 * value never lands on the entity, a read endpoint, audit, or the UI. The executor
 * reads it lazily at the moment a provider authenticates, then discards it.
 *
 * Resolution is deny-by-default: an unknown/absent reference resolves to
 * `undefined`, and the consuming adapter refuses the call rather than authenticating
 * with empty credentials.
 */

/**
 * Sealed connection material for a non-OAuth provider. Never persisted by KinOS.
 *
 * For connection-oriented services (CalDAV, IMAP, self-hosted APIs) the account's
 * `endpoint` travels with the credentials as one bundle — that is how a real secret
 * manager stores a service credential (host + user + password together), and it
 * keeps the collection URL out of the `Integration` entity and every read surface.
 * The endpoint is used only inside the execution boundary, never surfaced.
 */
export type SecretMaterial =
  | { readonly kind: "basic"; readonly username: string; readonly password: string; readonly endpoint?: string }
  | { readonly kind: "apiKey"; readonly key: string; readonly endpoint?: string }
  | { readonly kind: "raw"; readonly value: string };

export interface SecretStore {
  /** Resolve a reference to its material, or `undefined` if unknown/absent. */
  get(secretRef: string): Promise<SecretMaterial | undefined>;
}

/**
 * In-memory store seeded from a reference→material map. The dev/reference adapter:
 * a deployment swaps in its real secret manager behind the same port. Seeding is an
 * out-of-band admin step — the value never arrives through a KinOS API.
 */
export class MapSecretStore implements SecretStore {
  private readonly entries: Map<string, SecretMaterial>;

  constructor(seed: Readonly<Record<string, SecretMaterial>> = {}) {
    this.entries = new Map(Object.entries(seed));
  }

  async get(secretRef: string): Promise<SecretMaterial | undefined> {
    return this.entries.get(secretRef);
  }
}

/**
 * Build a `MapSecretStore` from a JSON env var (dev only):
 *   KINOS_SECRETS='{"secret://caldav/sph_1":{"kind":"basic","username":"u","password":"p"}}'
 * Malformed JSON yields an empty store (deny-by-default) rather than crashing boot.
 */
export function secretStoreFromEnv(raw: string | undefined): MapSecretStore {
  if (raw === undefined || raw.trim() === "") return new MapSecretStore();
  try {
    const parsed = JSON.parse(raw) as Record<string, SecretMaterial>;
    return new MapSecretStore(parsed);
  } catch {
    return new MapSecretStore();
  }
}
