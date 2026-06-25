/**
 * KinOS MVP CLI — runs the results-contract §19 acceptance scenario against the
 * local Ollama runtime and prints a pass/fail report. Exits non-zero if any
 * criterion fails. The Ollama base URL comes from $OLLAMA_BASE_URL.
 */

import { OllamaRuntime } from "@kinos/runtime-ollama";

import { runMvpScenario } from "./scenario.js";

const report = await runMvpScenario({
  runtime: new OllamaRuntime(),
  now: new Date().toISOString(),
});

console.log("KinOS MVP §19 acceptance\n");
for (const c of report.criteria) {
  console.log(`  ${c.passed ? "PASS" : "FAIL"}  ${c.description} — ${c.detail}`);
}
console.log(
  report.allPassed
    ? "\nAll §19 criteria passed."
    : "\nSome §19 criteria failed.",
);

process.exit(report.allPassed ? 0 : 1);
