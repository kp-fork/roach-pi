import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSkill(name: string): string {
  return readFileSync(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf-8");
}

describe("skill docs reference structured harness tools", () => {
  it("agentic-run-plan requires mandatory structured task status updates", () => {
    const src = readSkill("agentic-run-plan");
    expect(src).toContain("Task Status Update (MANDATORY)");
    expect(src).toContain('"action": "set_task_status"');
    expect(src).toContain("After the validator passes");
    expect(src).toContain("rendered output only");
  });

  it("agentic-long-run references harness_milestone, harness_plan, and canonical structured state", () => {
    const src = readSkill("agentic-long-run");
    expect(src).toContain("harness_milestone");
    expect(src).toContain("harness_plan");
    expect(src).toContain("canonical structured state");
  });

  it("agentic-long-run forbids main-agent direct task execution and requires structured task status", () => {
    const src = readSkill("agentic-long-run");
    expect(src).toContain("Do not execute plan tasks directly as the main agent");
    expect(src).toContain("harness_plan define_tasks");
    expect(src).toContain("harness_plan set_task_status");
    expect(src).toContain("harness_milestone set_status");
    expect(src).not.toContain("Update state.md: set milestone status");
    expect(src).not.toContain("Set milestone status to `skipped` in state.md");
  });

  it("agentic-plan-crafting references harness_plan and define_tasks", () => {
    const src = readSkill("agentic-plan-crafting");
    expect(src).toContain("harness_plan");
    expect(src).toContain("define_tasks");
  });

  it("agentic-review-work references harness_milestone", () => {
    const src = readSkill("agentic-review-work");
    expect(src).toContain("harness_milestone");
  });

  it("agentic-milestone-planning references harness_milestone", () => {
    const src = readSkill("agentic-milestone-planning");
    expect(src).toContain("harness_milestone");
  });
});
