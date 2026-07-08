import { describe, it, expect } from "vitest";
import { fileURLToPath } from "url";
import { loadAgentsFromDir } from "../agents.js";
import { PANEL_VERDICT_LINE, parsePanelVerdictOutput } from "../verdict-format.js";

const APPROVE_FIXTURE = [
  "CHECKS:",
  "- C1: YES — every file named in objective/constraints/evidenceRequired exists on disk",
  "- C2: YES — all referenced symbols found at their stated locations",
  "- C3: YES — no invented capabilities; stack verified against package.json",
  "- C4: YES — every evidenceRequired command present in package.json scripts",
  "- C5: N/A — no open decisions; ASSUMPTION-marked defaults treated as settled",
  "- C6: YES — satisfying evidenceRequired would prove the objective",
  "VERDICT: APPROVE",
  "FINDINGS:",
  "- [advisory] consider pinning the test runner version",
].join("\n");

const REJECT_FIXTURE = [
  "CHECKS:",
  "- C1: YES — all named files exist",
  "- C2: NO — symbol parseThing missing from parser.ts",
  "- C3: YES — capabilities exist",
  "- C4: YES — commands runnable",
  "- C5: YES — no gaps a worker must invent",
  "- C6: YES — evidence proves objective",
  "VERDICT: REJECT",
  "FINDINGS:",
  "- [REJECT-level] C2: symbol parseThing does not exist in parser.ts — evidence: grep returned no matches",
].join("\n");

describe("parsePanelVerdictOutput", () => {
  it("parses an all-YES APPROVE fixture in the exact .md-prescribed format", () => {
    const parsed = parsePanelVerdictOutput(APPROVE_FIXTURE);
    expect(parsed).not.toBeNull();
    expect(parsed!.verdict).toBe("APPROVE");
    expect(parsed!.checks).toHaveLength(6);
    expect(parsed!.checks[0]).toEqual({
      id: "C1",
      status: "YES",
      evidence: "every file named in objective/constraints/evidenceRequired exists on disk",
    });
    expect(parsed!.checks[4].id).toBe("C5");
    expect(parsed!.checks[4].status).toBe("N/A");
    expect(parsed!.findings).toEqual([
      { level: "advisory", text: "consider pinning the test runner version" },
    ]);
    expect(parsed!.rawOutput).toBe(APPROVE_FIXTURE);
  });

  it("parses a REJECT fixture with a NO check and a REJECT-level finding", () => {
    const parsed = parsePanelVerdictOutput(REJECT_FIXTURE);
    expect(parsed).not.toBeNull();
    expect(parsed!.verdict).toBe("REJECT");
    const c2 = parsed!.checks.find((check) => check.id === "C2");
    expect(c2).toBeDefined();
    expect(c2!.status).toBe("NO");
    expect(parsed!.findings).toHaveLength(1);
    expect(parsed!.findings[0].level).toBe("REJECT-level");
    expect(parsed!.findings[0].text).toContain("parseThing does not exist");
    expect(parsed!.rawOutput).toBe(REJECT_FIXTURE);
  });

  it("returns null when no VERDICT line is present (never defaults)", () => {
    const output = ["CHECKS:", "- C1: YES — checked", "FINDINGS:", "- [advisory] note"].join("\n");
    expect(parsePanelVerdictOutput(output)).toBeNull();
  });

  it("returns null when both an APPROVE and a REJECT line are present", () => {
    const output = ["CHECKS:", "- C1: YES — checked", "VERDICT: APPROVE", "VERDICT: REJECT"].join("\n");
    expect(parsePanelVerdictOutput(output)).toBeNull();
  });

  it("returns null when the verdict token is neither APPROVE nor REJECT", () => {
    const output = ["CHECKS:", "- C1: YES — checked", "VERDICT: MAYBE"].join("\n");
    expect(parsePanelVerdictOutput(output)).toBeNull();
  });
});

describe("panel verdict grammar drift pin", () => {
  it("every contract critic body prescribes the shared PANEL_VERDICT_LINE", async () => {
    const bundledDir = fileURLToPath(new URL("../agents/", import.meta.url));
    const agents = await loadAgentsFromDir(bundledDir, "bundled");
    for (const name of ["reviewer-feasibility", "reviewer-architecture", "reviewer-risk"]) {
      const agent = agents.find((candidate) => candidate.name === name);
      expect(agent, `bundled agent ${name} must exist`).toBeDefined();
      expect(agent!.systemPrompt, `${name} body must contain "${PANEL_VERDICT_LINE}"`).toContain(PANEL_VERDICT_LINE);
    }
  });
});
