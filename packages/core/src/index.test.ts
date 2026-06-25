import { describe, expect, it } from "vitest";

import { CORE_CONTRACT_VERSION } from "./index.js";

describe("@kinos/core toolchain", () => {
  it("exposes a contract version constant", () => {
    expect(CORE_CONTRACT_VERSION).toBe("0.1.0");
  });
});
