import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("parser isolation", () => {
  it("legacy-import-markdown.ts re-exports all expected functions", async () => {
    const mod = await import("../legacy-import-markdown.js");
    expect(typeof mod.reconstructPlanProgressFromSessionEntries).toBe("function");
    expect(typeof mod.reconstructMilestoneProgressFromSessionEntries).toBe("function");
    expect(typeof mod.loadPlanFromAssistantMessageEnd).toBe("function");
    expect(typeof mod.loadPlanFromToolResultEvent).toBe("function");
    expect(typeof mod.loadMilestonesFromAssistantMessage).toBe("function");
    expect(typeof mod.detectMilestonesFromToolResult).toBe("function");
    expect(typeof mod.reloadPlanFromSubagentArgs).toBe("function");
    expect(typeof mod.startPlanSubagentTasks).toBe("function");
    expect(typeof mod.completePlanSubagentTasks).toBe("function");
    expect(typeof mod.extractPlanPathsFromArgs).toBe("function");
    expect(typeof mod.extractMilestonePathsFromArgs).toBe("function");
    expect(typeof mod.startMilestonesFromSubagentArgs).toBe("function");
    expect(typeof mod.subagentItemRecords).toBe("function");
    expect(typeof mod.getToolExecutionArgs).toBe("function");
    expect(typeof mod.isCompletionFilePath).toBe("function");
    expect(typeof mod.extractMilestoneId).toBe("function");
  });

  it("index.ts imports parser functions from legacy-import-markdown.ts", () => {
    const src = readFileSync(new URL("../index.ts", import.meta.url), "utf-8");
    // Must import from legacy module, not directly from plan-progress-events
    expect(src).toContain('from "./legacy-import-markdown.js"');
    // Must NOT have a direct import from plan-progress-events
    expect(src).not.toMatch(/from\s+["']\.\/plan-progress-events\.js["']/);
  });

  it("index.ts gates parser-derived handlers behind structured state check", () => {
    const src = readFileSync(new URL("../index.ts", import.meta.url), "utf-8");
    // The tool_result handler should gate parser loading
    expect(src).toContain("!harnessProgress?.hasState())");
    // The message_end handler should gate parser loading
    expect(src).toContain("// LEGACY PATH — parser-derived plan/milestone loading from assistant prose");
  });

  it("session_start has structured-first restore path", () => {
    const src = readFileSync(new URL("../index.ts", import.meta.url), "utf-8");
    expect(src).toContain("structuredRunId");
    expect(src).toContain("// Primary path: load snapshot + replay structured events");
    expect(src).toContain("// LEGACY PATH — parser-derived reconstruction for pre-structured sessions");
  });

  it("no non-legacy module imports plan-progress-events directly", () => {
    const srcDir = new URL("../", import.meta.url);
    const files = readdirSync(srcDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    const violations: string[] = [];
    for (const file of files) {
      if (file === "legacy-import-markdown.ts" || file === "plan-progress-events.ts") continue;
      const content = readFileSync(new URL(file, srcDir), "utf-8");
      if (/from\s+["']\.\/plan-progress-events\.js["']/.test(content)) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });
});
