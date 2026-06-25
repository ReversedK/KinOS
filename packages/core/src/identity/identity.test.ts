import { describe, expect, it } from "vitest";

import { createIdentity } from "./identity.js";

describe("Identity", () => {
  it("creates an identity with a trimmed display name", () => {
    const identity = createIdentity({ id: "idy_1", displayName: "  Jane Doe  " });
    expect(identity.id).toBe("idy_1");
    expect(identity.displayName).toBe("Jane Doe");
  });

  it("rejects an empty display name (deny by default)", () => {
    expect(() => createIdentity({ id: "idy_1", displayName: "   " })).toThrow(/displayName/i);
  });
});
