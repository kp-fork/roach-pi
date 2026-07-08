import { describe, expect, it } from "vitest";

import { applyGoalCommand, buildGoalObjectiveHash, createGoalState, type GoalItem, type SubgoalItem } from "../goal-state.js";
import {
  buildSubgoalValidatorPrompt,
  buildSubgoalValidatorReceipt,
  parseSubgoalValidatorOutput,
} from "../subgoal-validator.js";

const START = "2026-07-08T00:00:00.000Z";

function fixture(): { goal: GoalItem; subgoal: SubgoalItem } {
  let state = createGoalState("run-validator", START);
  state = applyGoalCommand(state, {
    type: "create_goal",
    goal: {
      id: "goal-1",
      title: "Ship the validator loop",
      objective: "Ship the re-entrant worker validator loop",
      successCriteria: ["Loop dispatches worker then validator", "Budget halts after three strikes"],
      constraints: ["No reducer edits"],
      evidenceRequired: ["npm test output", "build output"],
      gates: { validator: true },
    },
  }, { now: START }).state;
  state = applyGoalCommand(state, {
    type: "create_subgoal",
    subgoal: {
      id: "subgoal-1",
      goalId: "goal-1",
      title: "Wire the loop",
      objective: "Wire the worker validator cycle into the runtime",
    },
  }, { now: START }).state;
  const goal = state.goals[0];
  return { goal, subgoal: goal.subgoals[0] };
}

describe("subgoal-validator", () => {
  it("builds an information-isolated validator prompt from subgoal fields only", () => {
    const { goal, subgoal } = fixture();
    const prompt = buildSubgoalValidatorPrompt(goal, subgoal);

    expect(prompt).toContain("You are an independent subgoal validator. You have NO knowledge of how the subgoal was implemented; judge only the codebase against the fields below.");
    expect(prompt).toContain(subgoal.objective);
    for (const criterion of goal.successCriteria) {
      expect(prompt).toContain(criterion);
    }
    for (const evidence of goal.evidenceRequired) {
      expect(prompt).toContain(evidence);
    }
    expect(prompt).toContain("Verdict: PASS|FAIL");
    expect(prompt.toLowerCase()).not.toContain("worker output");
    expect(prompt.toLowerCase()).not.toContain("sentinel");
  });

  it("parses the strict PASS grammar", () => {
    const parsed = parseSubgoalValidatorOutput("Verdict: PASS\nSummary: done\nBlockers:\nCommands Run:\n- npm test\nEvidence Checked:\n- ok");
    expect(parsed.verdict).toBe("PASS");
    expect(parsed.summary).toBe("done");
    expect(parsed.commandsRun).toEqual(["npm test"]);
    expect(parsed.evidence).toEqual(["ok"]);
  });

  it("defaults to FAIL when no Verdict line is present", () => {
    const parsed = parseSubgoalValidatorOutput("the validator crashed before emitting a verdict");
    expect(parsed.verdict).toBe("FAIL");
  });

  it("builds the M2 validator receipt shape with a fresh objective hash", () => {
    const { goal, subgoal } = fixture();
    const parsed = parseSubgoalValidatorOutput("Verdict: PASS\nSummary: verified\nBlockers:\nCommands Run:\n- npm test\nEvidence Checked:\n- ok");
    const receipt = buildSubgoalValidatorReceipt(goal, subgoal, parsed, { id: "v1", recordedAt: "2026-07-08T00:05:00.000Z" });

    expect(receipt).toMatchObject({
      id: "v1",
      targetType: "subgoal",
      targetId: subgoal.id,
      validatorAgent: "plan-validator",
      verdict: "PASS",
      recordedAt: "2026-07-08T00:05:00.000Z",
      summary: "verified",
    });
    expect(receipt.objectiveHash).toBe(buildGoalObjectiveHash(goal, subgoal));
    expect(receipt.commandsRun).toEqual(["npm test"]);
    expect(receipt.evidence).toEqual(["ok"]);
    expect(receipt.rawOutput).toContain("Verdict: PASS");
  });
});
