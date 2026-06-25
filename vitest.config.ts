import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "ui/**/*.test.ts"],
    environment: "node",
  },
});
