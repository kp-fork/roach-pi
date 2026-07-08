import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSkill(name: string): string {
  return readFileSync(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf-8");
}

const legacySkillNames = [
  ["agentic", "pl", "an", "crafting"].join("-"),
  ["agentic", "run", "pl", "an"].join("-"),
  ["agentic", "milestone", "planning"].join("-"),
  ["agentic", "long", "run"].join("-"),
  ["agentic", "review", "work"].join("-"),
];
const removedPlanRoute = ["/", "pl", "an"].join("");
const removedRunPlanTerm = ["run", "pl", "an"].join("-");
const removedLongRunTerm = ["long", "run"].join("-");

function discoveredSkillNames(): string[] {
  const skillsDir = new URL("../skills/", import.meta.url);
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(new URL(`${entry.name}/SKILL.md`, skillsDir)))
    .map((entry) => entry.name)
    .sort();
}

describe("goal skill docs", () => {
  it("agentic-goal requires durable goal runtime, todos, evidence, and verifier PASS", () => {
    const src = readSkill("agentic-goal");

    expect(src).toContain("/goal status");
    expect(src).toContain("/goal <request>");
    expect(src).toContain("New Request Triage");
    expect(src).toContain("answer directly as a normal prompt");
    expect(src).toContain("Goal Contract before activation");
    expect(src).toContain("todoread");
    expect(src).toContain("todowrite");
    expect(src).toContain("/goal evidence");
    expect(src).toContain("verifier subagent returns PASS");
    expect(src).toContain("verifier returns FAIL");
    // M5: for flagged (worker→validator) goals the RUNTIME implements subgoals;
    // the main agent only advances /goal
    expect(src).toContain("the runtime implements each subgoal through an isolated worker→validator loop");
    expect(src).toContain("do not implement subgoals yourself; advance the runtime by running /goal");
    expect(src).toContain("prefer the manual /goal create → activate → complete path");
    // M6: goal completion is review-gated — the security/qa review panel runs after
    // the goal verifier PASS, and review FAIL recycles into fix subgoals
    expect(src).toContain("the runtime opens the security/qa review panel");
    expect(src).toContain("review FAIL recycles into fix subgoals");
    expect(src).not.toContain("Goal PASS: stop");
    for (const legacySkillName of legacySkillNames) {
      expect(src).not.toContain(legacySkillName);
    }
  });
});

describe("clarification skill goal handoff", () => {
  it("requires Goal Contract output and excludes legacy routing strings", () => {
    const src = readSkill("agentic-clarification");

    expect(src).toContain("Goal Contract");
    expect(src).toContain("/goal");
    expect(src).toContain("clarification_state");
    expect(src).toContain("Runtime Gate");
    expect(src).toContain("Gate: PASS");
    expect(src.toLowerCase()).toContain("non-goals");
    expect(src).toContain("Edge cases");
    expect(src).toContain("Technical context");
    expect(src).toContain("Use explorer only when needed");
    expect(src).toContain("non-code/product/wording clarification");
    expect(src).toContain("technical context is missing/uncertain");
    expect(src).not.toContain("Always use subagents");
    expect(src).not.toContain("Immediately after asking the user a question");
    expect(src).not.toContain("Run in parallel with user Q&A");
    expect(src.toLowerCase()).toContain("success criteria");
    expect(src.toLowerCase()).toContain("evidence required");
    // recon-before-questions
    expect(src).toContain("The user should never be asked something the codebase can answer.");
    // single bundled ≤4-question round
    expect(src).toContain("ONE ask_user_question round");
    expect(src).toContain("up to 4 independent questions");
    // defensible defaults + ASSUMPTION literal
    expect(src).toContain("Prefer proposing a defensible default over asking.");
    expect(src).toContain("ASSUMPTION:");
    // one-question-at-a-time language must be gone
    expect(src).not.toContain("One question per message");
    expect(src).not.toContain("Never bundle multiple questions");
    expect(src).not.toContain("Ask user ONE question");
    expect(src).not.toContain("Ask ONE question");
    expect(src).not.toContain("Five questions in one message");
    expect(src).not.toContain(legacySkillNames[0]);
    expect(src).not.toContain(legacySkillNames[2]);
    expect(src).not.toContain(removedPlanRoute);
    expect(src).not.toContain("milestones");
    expect(src).not.toContain(removedRunPlanTerm);
    expect(src).not.toContain(removedLongRunTerm);
  });
});

describe("goal runtime skill discovery surface", () => {
  it("discovers agentic-goal and hides legacy public workflow skills", () => {
    const skills = discoveredSkillNames();

    expect(skills).toContain("agentic-goal");
    for (const legacySkillName of legacySkillNames) {
      expect(skills).not.toContain(legacySkillName);
    }
  });
});
