import { describe, expect, it } from "vitest";
import {
  applyGoalCommand,
  buildGoalObjectiveHash,
  createGoalState,
  GoalInvariantError,
  isPanelApproved,
  type GoalItem,
  type GoalState,
  type GoalValidatorReceipt,
  type GoalVerifierReceipt,
  type PanelState,
  type SubgoalItem,
  GOAL_STATE_SCHEMA_VERSION,
  GOAL_VALIDATOR_AGENT,
  REVIEW_PANEL_ID,
} from "../goal-state.js";

const START = "2026-05-28T00:00:00.000Z";

function createGoal() {
  return applyGoalCommand(createGoalState("run-1", START), {
    type: "create_goal",
    goal: {
      id: "goal-1",
      title: "Goal 1",
      objective: "Ship goal runtime",
      priority: "high",
      successCriteria: ["Reducer works"],
      constraints: ["Use deterministic ids"],
      evidenceRequired: ["Tests pass"],
    },
  }, { now: "2026-05-28T00:01:00.000Z" }).state;
}

function passReceipt(goal: GoalItem, id = "receipt-1"): GoalVerifierReceipt {
  return {
    id,
    targetType: "goal",
    targetId: goal.id,
    objectiveHash: buildGoalObjectiveHash(goal),
    verdict: "PASS",
    verifiedAt: "2026-05-28T00:03:00.000Z",
    verifierAgent: "reviewer-verifier",
    summary: "Verified",
    blockers: [],
    commandsRun: ["npm test -- tests/goal-state.test.ts"],
    evidence: ["Tests pass"],
    rawOutput: "Verdict: PASS\nSummary: Verified",
  };
}

function failReceipt(goal: GoalItem): GoalVerifierReceipt {
  return {
    ...passReceipt(goal, "receipt-fail"),
    verdict: "FAIL",
    summary: "Blocked",
    blockers: ["Missing evidence"],
    rawOutput: "Verdict: FAIL\nSummary: Blocked",
  };
}

describe("goal-state reducer", () => {
  it("initializes goal state", () => {
    const state = createGoalState("run-1", START);

    expect(state).toMatchObject({
      schemaVersion: GOAL_STATE_SCHEMA_VERSION,
      runId: "run-1",
      status: "idle",
      goals: [],
      ledger: [],
      continuation: { queued: false, blockers: [], consecutiveFailures: {} },
      createdAt: START,
      updatedAt: START,
    });
  });

  it("creates and activates a goal", () => {
    let state = createGoal();

    expect(state.goals[0]).toMatchObject({
      id: "goal-1",
      title: "Goal 1",
      status: "queued",
      priority: "high",
      successCriteria: ["Reducer works"],
      constraints: ["Use deterministic ids"],
      evidenceRequired: ["Tests pass"],
    });
    expect(state.ledger.map((entry) => entry.type)).toEqual(["goal_created"]);

    state = applyGoalCommand(state, {
      type: "activate_goal",
      goalId: "goal-1",
    }, { now: "2026-05-28T00:02:00.000Z" }).state;

    expect(state.status).toBe("active");
    expect(state.activeGoalId).toBe("goal-1");
    expect(state.goals[0].status).toBe("active");
    expect(state.ledger.map((entry) => entry.type)).toEqual(["goal_created", "goal_activated"]);
  });

  it("creates subgoals with dependencies", () => {
    let state = createGoal();
    state = applyGoalCommand(state, {
      type: "create_subgoal",
      subgoal: {
        id: "subgoal-1",
        goalId: "goal-1",
        title: "First subgoal",
        objective: "Implement types",
      },
    }, { now: "2026-05-28T00:02:00.000Z" }).state;
    state = applyGoalCommand(state, {
      type: "create_subgoal",
      subgoal: {
        id: "subgoal-2",
        goalId: "goal-1",
        title: "Second subgoal",
        objective: "Implement commands",
        dependencies: ["subgoal-1"],
      },
    }, { now: "2026-05-28T00:03:00.000Z" }).state;

    expect(state.goals[0].activeSubgoalId).toBe("subgoal-1");
    expect(state.goals[0].subgoals.map((subgoal) => ({
      id: subgoal.id,
      status: subgoal.status,
      dependencies: subgoal.dependencies,
    }))).toEqual([
      { id: "subgoal-1", status: "active", dependencies: [] },
      { id: "subgoal-2", status: "queued", dependencies: ["subgoal-1"] },
    ]);
  });

  it("appends evidence to the ledger", () => {
    const state = applyGoalCommand(createGoal(), {
      type: "add_evidence",
      targetType: "goal",
      targetId: "goal-1",
      evidence: "npm test passed",
    }, { now: "2026-05-28T00:02:00.000Z" }).state;

    expect(state.ledger.at(-1)).toMatchObject({
      seq: 2,
      type: "evidence_added",
      goalId: "goal-1",
      message: "npm test passed",
    });
  });

  it("fails to complete without a PASS receipt", () => {
    const state = createGoal();

    expect(() => applyGoalCommand(state, {
      type: "complete_target",
      targetType: "goal",
      targetId: "goal-1",
    }, { now: "2026-05-28T00:02:00.000Z" })).toThrow(GoalInvariantError);
  });

  it("keeps a FAIL receipt from allowing completion", () => {
    let state = createGoal();
    state = applyGoalCommand(state, {
      type: "record_verifier_result",
      receipt: failReceipt(state.goals[0]),
    }, { now: "2026-05-28T00:02:00.000Z" }).state;

    expect(state.goals[0].status).toBe("blocked");
    expect(() => applyGoalCommand(state, {
      type: "complete_target",
      targetType: "goal",
      targetId: "goal-1",
    }, { now: "2026-05-28T00:03:00.000Z" })).toThrow(GoalInvariantError);
  });

  it("allows completion with a fresh PASS receipt", () => {
    let state = createGoal();
    state = applyGoalCommand(state, {
      type: "request_completion",
      targetType: "goal",
      targetId: "goal-1",
    }, { now: "2026-05-28T00:02:00.000Z" }).state;
    state = applyGoalCommand(state, {
      type: "record_verifier_result",
      receipt: passReceipt(state.goals[0]),
    }, { now: "2026-05-28T00:03:00.000Z" }).state;
    state = applyGoalCommand(state, {
      type: "complete_target",
      targetType: "goal",
      targetId: "goal-1",
    }, { now: "2026-05-28T00:04:00.000Z" }).state;

    expect(state.goals[0].status).toBe("completed");
    expect(state.status).toBe("completed");
  });

  it("treats new evidence after PASS as a stale receipt", () => {
    let state = createGoal();
    state = applyGoalCommand(state, {
      type: "record_verifier_result",
      receipt: passReceipt(state.goals[0]),
    }, { now: "2026-05-28T00:02:00.000Z" }).state;
    state = applyGoalCommand(state, {
      type: "add_evidence",
      targetType: "goal",
      targetId: "goal-1",
      evidence: "new evidence after verifier pass",
    }, { now: "2026-05-28T00:03:00.000Z" }).state;

    expect(() => applyGoalCommand(state, {
      type: "complete_target",
      targetType: "goal",
      targetId: "goal-1",
    }, { now: "2026-05-28T00:04:00.000Z" })).toThrow(/stale/);
  });

  it("marks the run completed when all goals are completed", () => {
    let state = createGoal();
    state = applyGoalCommand(state, {
      type: "create_goal",
      goal: {
        id: "goal-2",
        title: "Goal 2",
        objective: "Finish docs",
        successCriteria: ["Docs updated"],
        evidenceRequired: ["Docs test"],
      },
    }, { now: "2026-05-28T00:02:00.000Z" }).state;

    state = applyGoalCommand(state, {
      type: "record_verifier_result",
      receipt: passReceipt(state.goals[0], "receipt-goal-1"),
    }, { now: "2026-05-28T00:03:00.000Z" }).state;
    state = applyGoalCommand(state, {
      type: "complete_target",
      targetType: "goal",
      targetId: "goal-1",
    }, { now: "2026-05-28T00:04:00.000Z" }).state;

    expect(state.status).not.toBe("completed");

    state = applyGoalCommand(state, {
      type: "record_verifier_result",
      receipt: passReceipt(state.goals[1], "receipt-goal-2"),
    }, { now: "2026-05-28T00:05:00.000Z" }).state;
    state = applyGoalCommand(state, {
      type: "complete_target",
      targetType: "goal",
      targetId: "goal-2",
    }, { now: "2026-05-28T00:06:00.000Z" }).state;

    expect(state.status).toBe("completed");
    expect(state.activeGoalId).toBeUndefined();
  });
});

describe("M1 panels + gates", () => {
  const T_OPEN = "2026-05-28T00:02:00.000Z";
  const T_A = "2026-05-28T00:03:00.000Z";
  const T_B = "2026-05-28T00:04:00.000Z";
  const T_GATE = "2026-05-28T00:05:00.000Z";

  function withPanel(expectedMembers: string[] = ["a", "b"]): GoalState {
    return applyGoalCommand(createGoal(), {
      type: "open_panel",
      panel: { panelId: "panel-1", purpose: "activation review", expectedMembers },
    }, { now: T_OPEN }).state;
  }

  function recordVerdict(
    state: GoalState,
    member: string,
    verdict: "APPROVE" | "REJECT",
    now: string,
    findings?: string,
  ): GoalState {
    return applyGoalCommand(state, {
      type: "record_panel_verdict",
      panelId: "panel-1",
      member,
      verdict,
      findings,
    }, { now }).state;
  }

  it("all-of-N: approves only when every expected member approves, gating activation", () => {
    let state = withPanel();
    state = recordVerdict(state, "a", "APPROVE", T_A);
    state = recordVerdict(state, "b", "APPROVE", T_B);

    const panel: PanelState = state.panels[0];
    expect(isPanelApproved(panel)).toBe(true);

    state = applyGoalCommand(state, {
      type: "activate_goal_gated",
      goalId: "goal-1",
      panelId: "panel-1",
    }, { now: T_GATE }).state;

    expect(state.goals[0].status).toBe("active");
    expect(state.status).toBe("active");
    expect(state.activeGoalId).toBe("goal-1");
    expect(state.ledger.at(-1)?.type).toBe("goal_activated_gated");
  });

  it("all-of-N: partial verdicts are rejected (missing member = NO)", () => {
    let state = withPanel();
    state = recordVerdict(state, "a", "APPROVE", T_A);

    expect(isPanelApproved(state.panels[0])).toBe(false);
    expect(() => applyGoalCommand(state, {
      type: "activate_goal_gated",
      goalId: "goal-1",
      panelId: "panel-1",
    }, { now: T_GATE })).toThrow(GoalInvariantError);
    expect(state.goals[0].status).toBe("queued");
  });

  it("all-of-N: zero verdicts are rejected", () => {
    const state = withPanel();

    expect(isPanelApproved(state.panels[0])).toBe(false);
    expect(() => applyGoalCommand(state, {
      type: "activate_goal_gated",
      goalId: "goal-1",
      panelId: "panel-1",
    }, { now: T_GATE })).toThrow(GoalInvariantError);
  });

  it("all-of-N: a REJECT verdict blocks activation", () => {
    let state = withPanel();
    state = recordVerdict(state, "a", "APPROVE", T_A);
    state = recordVerdict(state, "b", "REJECT", T_B, "not ready");

    expect(isPanelApproved(state.panels[0])).toBe(false);
    expect(() => applyGoalCommand(state, {
      type: "activate_goal_gated",
      goalId: "goal-1",
      panelId: "panel-1",
    }, { now: T_GATE })).toThrow(GoalInvariantError);
  });

  it("activate_goal_gated throws GoalInvariantError for an unknown panel", () => {
    const state = createGoal();

    expect(() => applyGoalCommand(state, {
      type: "activate_goal_gated",
      goalId: "goal-1",
      panelId: "panel-missing",
    }, { now: T_GATE })).toThrow(GoalInvariantError);
  });

  it("re-recording a member's verdict upserts a single entry", () => {
    let state = withPanel();
    state = recordVerdict(state, "a", "REJECT", T_A);
    state = recordVerdict(state, "a", "APPROVE", T_B);

    const verdictsForA = state.panels[0].verdicts.filter((verdict) => verdict.member === "a");
    expect(verdictsForA).toHaveLength(1);
    expect(verdictsForA[0].verdict).toBe("APPROVE");
  });

  it("re-opening a panel increments its round and clears verdicts", () => {
    let state = withPanel();
    state = recordVerdict(state, "a", "APPROVE", T_A);
    state = applyGoalCommand(state, {
      type: "open_panel",
      panel: { panelId: "panel-1", purpose: "second round", expectedMembers: ["a", "b"] },
    }, { now: T_B }).state;

    expect(state.panels).toHaveLength(1);
    expect(state.panels[0].round).toBe(2);
    expect(state.panels[0].verdicts).toEqual([]);
    expect(state.panels[0].purpose).toBe("second round");
  });

  it("create_goal materializes gates onto the goal", () => {
    const state = applyGoalCommand(createGoalState("run-1", START), {
      type: "create_goal",
      goal: {
        id: "goal-gated",
        title: "Gated goal",
        objective: "Ship gated activation",
        gates: { panel: true, validator: true },
      },
    }, { now: T_OPEN }).state;

    expect(state.goals[0].gates).toEqual({ panel: true, validator: true });
  });

  it("golden pre-gates sequence is behavior-identical when gates are absent", () => {
    let state = createGoal();
    state = applyGoalCommand(state, {
      type: "request_completion",
      targetType: "goal",
      targetId: "goal-1",
    }, { now: T_OPEN }).state;
    state = applyGoalCommand(state, {
      type: "record_verifier_result",
      receipt: passReceipt(state.goals[0]),
    }, { now: T_A }).state;
    state = applyGoalCommand(state, {
      type: "complete_target",
      targetType: "goal",
      targetId: "goal-1",
    }, { now: T_B }).state;

    expect(state.goals[0].gates).toBeUndefined();
    expect(state.goals[0].status).toBe("completed");
    expect(state.ledger.map((entry) => entry.type)).toEqual([
      "goal_created",
      "completion_requested",
      "verifier_pass",
      "goal_completed",
    ]);
  });

  it("createGoalState initializes panels", () => {
    expect(createGoalState("run-1", START).panels).toEqual([]);
  });

  it("deep-clones panels so mutations do not leak back", () => {
    const base: GoalState = {
      ...createGoal(),
      panels: [
        {
          panelId: "panel-1",
          purpose: "activation review",
          expectedMembers: ["a", "b"],
          round: 1,
          verdicts: [{ member: "a", verdict: "APPROVE", recordedAt: T_A }],
        },
      ],
    };

    const next = applyGoalCommand(base, {
      type: "add_evidence",
      targetType: "goal",
      targetId: "goal-1",
      evidence: "unrelated evidence",
    }, { now: T_B }).state;

    next.panels[0].expectedMembers.push("c");
    next.panels[0].verdicts.push({ member: "z", verdict: "APPROVE", recordedAt: T_B });

    expect(base.panels[0].expectedMembers).toEqual(["a", "b"]);
    expect(base.panels[0].verdicts).toHaveLength(1);
    expect(base.panels[0].verdicts[0].member).toBe("a");
  });

  it("plain activate_goal stays unconditional with no panel present", () => {
    const state = applyGoalCommand(createGoal(), {
      type: "activate_goal",
      goalId: "goal-1",
    }, { now: T_OPEN }).state;

    expect(state.goals[0].status).toBe("active");
    expect(state.status).toBe("active");
    expect(state.activeGoalId).toBe("goal-1");
    expect(state.ledger.at(-1)?.type).toBe("goal_activated");
  });
});

// M2 Task 0 expected FAIL reasons (pinned BEFORE implementation; red must be understood):
// - `GOAL_VALIDATOR_AGENT` / `GoalValidatorReceipt` are not exported yet (imports resolve to undefined).
// - `record_validator_receipt` has no reducer case, so `applyGoalCommand(...)` falls through the
//   switch, returns undefined, and `.state` access throws a TypeError.
// - `assertCompletionInvariant` still routes gated subgoals through the verifier path, so
//   validator-gated completes throw "latest verifier receipt is not PASS" instead of succeeding
//   (or instead of the validator-specific messages).
// - `bumpFailureBudget` does not exist, so `continuation.consecutiveFailures` stays empty.
// - The gates-absent golden cases and the never-touch guards may already pass — they pin
//   byte-identity of the existing verifier path and the budget's zero-bleed contract.
describe("M2 validator receipts + failure budget", () => {
  const T2 = "2026-05-28T00:02:00.000Z";
  const T3 = "2026-05-28T00:03:00.000Z";
  const T4 = "2026-05-28T00:04:00.000Z";
  const T5 = "2026-05-28T00:05:00.000Z";
  const T6 = "2026-05-28T00:06:00.000Z";

  function goalWithSubgoal(gates?: { panel?: boolean; validator?: boolean; review?: boolean }): GoalState {
    let state = applyGoalCommand(createGoalState("run-1", START), {
      type: "create_goal",
      goal: {
        id: "goal-1",
        title: "Goal 1",
        objective: "Ship validator gating",
        successCriteria: ["Reducer works"],
        evidenceRequired: ["Tests pass"],
        gates,
      },
    }, { now: "2026-05-28T00:01:00.000Z" }).state;
    state = applyGoalCommand(state, {
      type: "create_subgoal",
      subgoal: {
        id: "subgoal-1",
        goalId: "goal-1",
        title: "First subgoal",
        objective: "Implement it",
      },
    }, { now: T2 }).state;
    return state;
  }

  function gatedGoalWithSubgoal(): GoalState {
    return goalWithSubgoal({ validator: true });
  }

  function buildValidatorReceipt(
    goal: GoalItem,
    subgoal: SubgoalItem,
    verdict: "PASS" | "FAIL",
    id: string,
  ): GoalValidatorReceipt {
    return {
      id,
      targetType: "subgoal",
      targetId: subgoal.id,
      objectiveHash: buildGoalObjectiveHash(goal, subgoal),
      verdict,
      recordedAt: T3,
      validatorAgent: GOAL_VALIDATOR_AGENT,
      summary: verdict === "PASS" ? "Validated" : "Blocked",
      blockers: verdict === "PASS" ? [] : ["Missing evidence"],
      commandsRun: ["npm test -- tests/goal-state.test.ts"],
      evidence: ["Tests pass"],
      rawOutput: `Verdict: ${verdict}`,
    };
  }

  function passValidatorReceipt(goal: GoalItem, subgoal: SubgoalItem, id = "vr-1"): GoalValidatorReceipt {
    return buildValidatorReceipt(goal, subgoal, "PASS", id);
  }

  function failValidatorReceipt(goal: GoalItem, subgoal: SubgoalItem, id = "vr-fail"): GoalValidatorReceipt {
    return buildValidatorReceipt(goal, subgoal, "FAIL", id);
  }

  function subgoalVerifierReceipt(
    goal: GoalItem,
    subgoal: SubgoalItem,
    verdict: "PASS" | "FAIL",
    id = "receipt-sub",
  ): GoalVerifierReceipt {
    return {
      id,
      targetType: "subgoal",
      targetId: subgoal.id,
      objectiveHash: buildGoalObjectiveHash(goal, subgoal),
      verdict,
      verifiedAt: T3,
      verifierAgent: "reviewer-verifier",
      summary: verdict === "PASS" ? "Verified" : "Blocked",
      blockers: verdict === "PASS" ? [] : ["Missing evidence"],
      commandsRun: ["npm test -- tests/goal-state.test.ts"],
      evidence: ["Tests pass"],
      rawOutput: `Verdict: ${verdict}`,
    };
  }

  it("gated subgoal completes via validator PASS receipt + validator_pass ledger row", () => {
    let state = gatedGoalWithSubgoal();
    state = applyGoalCommand(state, {
      type: "request_completion",
      targetType: "subgoal",
      targetId: "subgoal-1",
    }, { now: T3 }).state;

    const receipt = passValidatorReceipt(state.goals[0], state.goals[0].subgoals[0]);
    state = applyGoalCommand(state, {
      type: "record_validator_receipt",
      receipt,
    }, { now: T4 }).state;

    expect(state.goals[0].subgoals[0].validatorReceipts).toHaveLength(1);
    expect(state.ledger.at(-1)).toMatchObject({
      type: "validator_pass",
      goalId: "goal-1",
      subgoalId: "subgoal-1",
      data: { receiptId: "vr-1" },
    });

    state = applyGoalCommand(state, {
      type: "complete_target",
      targetType: "subgoal",
      targetId: "subgoal-1",
    }, { now: T5 }).state;

    expect(state.goals[0].subgoals[0].status).toBe("completed");
  });

  it("gated subgoal throws without a validator receipt", () => {
    let state = gatedGoalWithSubgoal();
    state = applyGoalCommand(state, {
      type: "request_completion",
      targetType: "subgoal",
      targetId: "subgoal-1",
    }, { now: T3 }).state;

    expect(() => applyGoalCommand(state, {
      type: "complete_target",
      targetType: "subgoal",
      targetId: "subgoal-1",
    }, { now: T4 })).toThrow(/latest validator receipt is not PASS/);
  });

  it("gated subgoal throws when the validator_pass ledger row is missing (full cross-check)", () => {
    let state = gatedGoalWithSubgoal();
    state = applyGoalCommand(state, {
      type: "request_completion",
      targetType: "subgoal",
      targetId: "subgoal-1",
    }, { now: T3 }).state;
    // Hand-inject the receipt WITHOUT emitting record_validator_receipt: no validator_pass ledger entry.
    state.goals[0].subgoals[0].validatorReceipts = [
      passValidatorReceipt(state.goals[0], state.goals[0].subgoals[0]),
    ];

    expect(() => applyGoalCommand(state, {
      type: "complete_target",
      targetType: "subgoal",
      targetId: "subgoal-1",
    }, { now: T4 })).toThrow(/validator PASS ledger entry is missing/);
  });

  it("gated subgoal rejects a verifier-only receipt", () => {
    let state = gatedGoalWithSubgoal();
    state = applyGoalCommand(state, {
      type: "request_completion",
      targetType: "subgoal",
      targetId: "subgoal-1",
    }, { now: T3 }).state;
    state = applyGoalCommand(state, {
      type: "record_verifier_result",
      receipt: subgoalVerifierReceipt(state.goals[0], state.goals[0].subgoals[0], "PASS"),
    }, { now: T4 }).state;

    expect(() => applyGoalCommand(state, {
      type: "complete_target",
      targetType: "subgoal",
      targetId: "subgoal-1",
    }, { now: T5 })).toThrow(/latest validator receipt is not PASS/);
  });

  it("validator receipt recorded before add_evidence is stale", () => {
    let state = gatedGoalWithSubgoal();
    state = applyGoalCommand(state, {
      type: "request_completion",
      targetType: "subgoal",
      targetId: "subgoal-1",
    }, { now: T3 }).state;
    state = applyGoalCommand(state, {
      type: "record_validator_receipt",
      receipt: passValidatorReceipt(state.goals[0], state.goals[0].subgoals[0]),
    }, { now: T4 }).state;
    state = applyGoalCommand(state, {
      type: "add_evidence",
      targetType: "subgoal",
      targetId: "subgoal-1",
      evidence: "new evidence after validator pass",
    }, { now: T5 }).state;

    expect(() => applyGoalCommand(state, {
      type: "complete_target",
      targetType: "subgoal",
      targetId: "subgoal-1",
    }, { now: T6 })).toThrow(/stale/);
  });

  it("gates absent: verifier rule is byte-identical (golden, positive)", () => {
    let state = goalWithSubgoal();
    state = applyGoalCommand(state, {
      type: "request_completion",
      targetType: "subgoal",
      targetId: "subgoal-1",
    }, { now: T3 }).state;
    state = applyGoalCommand(state, {
      type: "record_verifier_result",
      receipt: subgoalVerifierReceipt(state.goals[0], state.goals[0].subgoals[0], "PASS"),
    }, { now: T4 }).state;
    state = applyGoalCommand(state, {
      type: "complete_target",
      targetType: "subgoal",
      targetId: "subgoal-1",
    }, { now: T5 }).state;

    expect(state.goals[0].subgoals[0].status).toBe("completed");
    expect(state.goals[0].subgoals[0].validatorReceipts).toBeUndefined();
    expect(state.ledger.map((entry) => entry.type)).toContain("verifier_pass");
    expect(state.ledger.map((entry) => entry.type)).not.toContain("validator_pass");
  });

  it("gates absent: a validator-only receipt does NOT complete", () => {
    let state = goalWithSubgoal();
    state = applyGoalCommand(state, {
      type: "request_completion",
      targetType: "subgoal",
      targetId: "subgoal-1",
    }, { now: T3 }).state;
    state.goals[0].subgoals[0].validatorReceipts = [
      passValidatorReceipt(state.goals[0], state.goals[0].subgoals[0]),
    ];

    expect(() => applyGoalCommand(state, {
      type: "complete_target",
      targetType: "subgoal",
      targetId: "subgoal-1",
    }, { now: T4 })).toThrow(/latest verifier receipt is not PASS/);
  });

  it("budget: gated goal-level verifier FAIL increments and PASS resets", () => {
    let state = gatedGoalWithSubgoal();
    state = applyGoalCommand(state, {
      type: "record_verifier_result",
      receipt: failReceipt(state.goals[0]),
    }, { now: T3 }).state;
    expect(state.continuation.consecutiveFailures["goal-1"]).toBe(1);

    state = applyGoalCommand(state, {
      type: "record_verifier_result",
      receipt: { ...failReceipt(state.goals[0]), id: "receipt-fail-2" },
    }, { now: T4 }).state;
    expect(state.continuation.consecutiveFailures["goal-1"]).toBe(2);

    state = applyGoalCommand(state, {
      type: "record_verifier_result",
      receipt: passReceipt(state.goals[0]),
    }, { now: T5 }).state;
    expect(state.continuation.consecutiveFailures["goal-1"]).toBeUndefined();
  });

  it("budget: gated subgoal validator FAIL increments and PASS resets", () => {
    let state = gatedGoalWithSubgoal();
    state = applyGoalCommand(state, {
      type: "record_validator_receipt",
      receipt: failValidatorReceipt(state.goals[0], state.goals[0].subgoals[0]),
    }, { now: T3 }).state;
    expect(state.continuation.consecutiveFailures["subgoal-1"]).toBe(1);

    state = applyGoalCommand(state, {
      type: "record_validator_receipt",
      receipt: failValidatorReceipt(state.goals[0], state.goals[0].subgoals[0], "vr-fail-2"),
    }, { now: T4 }).state;
    expect(state.continuation.consecutiveFailures["subgoal-1"]).toBe(2);

    state = applyGoalCommand(state, {
      type: "record_validator_receipt",
      receipt: passValidatorReceipt(state.goals[0], state.goals[0].subgoals[0]),
    }, { now: T5 }).state;
    expect(state.continuation.consecutiveFailures["subgoal-1"]).toBeUndefined();
  });

  it("budget: survives the clear_continuation-before-record ordering", () => {
    let state = gatedGoalWithSubgoal();
    state = applyGoalCommand(state, {
      type: "record_validator_receipt",
      receipt: failValidatorReceipt(state.goals[0], state.goals[0].subgoals[0]),
    }, { now: T3 }).state;
    expect(state.continuation.consecutiveFailures["subgoal-1"]).toBe(1);

    state = applyGoalCommand(state, {
      type: "queue_continuation",
      targetType: "subgoal",
      targetId: "subgoal-1",
      reason: "validator failed",
    }, { now: T4 }).state;
    // Mirrors index.ts /goal complete handler: clear_continuation BEFORE the receipt is recorded.
    state = applyGoalCommand(state, { type: "clear_continuation" }, { now: T5 }).state;
    state = applyGoalCommand(state, {
      type: "record_validator_receipt",
      receipt: failValidatorReceipt(state.goals[0], state.goals[0].subgoals[0], "vr-fail-2"),
    }, { now: T6 }).state;

    expect(state.continuation.consecutiveFailures["subgoal-1"]).toBe(2);
  });

  it("budget: an UNGATED FAIL leaves consecutiveFailures untouched", () => {
    let state = goalWithSubgoal();
    state = applyGoalCommand(state, {
      type: "record_verifier_result",
      receipt: subgoalVerifierReceipt(state.goals[0], state.goals[0].subgoals[0], "FAIL", "receipt-sub-fail"),
    }, { now: T3 }).state;
    state = applyGoalCommand(state, {
      type: "record_validator_receipt",
      receipt: failValidatorReceipt(state.goals[0], state.goals[0].subgoals[0]),
    }, { now: T4 }).state;

    expect(state.continuation.consecutiveFailures).toEqual({});
  });

  it("budget: panel verdicts never touch it", () => {
    let state = gatedGoalWithSubgoal();
    state = applyGoalCommand(state, {
      type: "open_panel",
      panel: { panelId: "panel-1", purpose: "activation review", expectedMembers: ["a"] },
    }, { now: T3 }).state;
    state = applyGoalCommand(state, {
      type: "record_panel_verdict",
      panelId: "panel-1",
      member: "a",
      verdict: "REJECT",
      findings: "not ready",
    }, { now: T4 }).state;

    expect(state.continuation.consecutiveFailures).toEqual({});
  });
});

// M6 Task 0 expected FAIL reasons (pinned BEFORE implementation; red must be understood):
// - `REVIEW_PANEL_ID` is not exported yet, so the import resolves to undefined and the
//   open_panel fixtures open a panel with panelId === undefined.
// - `assertCompletionInvariant` has NO review clause, so `complete_target` on a
//   `gates: { review: true }` goal WITHOUT an approved review panel SUCCEEDS today —
//   the new "throws without/partial/REJECT review panel" tests expect a throw; that is
//   the red Task 1 turns green.
// - The flag-absent golden and the "verifier still required first" case may already pass —
//   they pin byte-identity of the existing verifier path (the clause is layered ON TOP).
describe("M6 review-gate completion invariant", () => {
  const T2 = "2026-05-28T00:02:00.000Z";
  const T3 = "2026-05-28T00:03:00.000Z";
  const T4 = "2026-05-28T00:04:00.000Z";
  const T5 = "2026-05-28T00:05:00.000Z";
  const T6 = "2026-05-28T00:06:00.000Z";
  const T7 = "2026-05-28T00:07:00.000Z";
  const REVIEW_MEMBERS = ["security-reviewer", "qa-reviewer"];

  function createReviewGatedGoal(): GoalState {
    return applyGoalCommand(createGoalState("run-1", START), {
      type: "create_goal",
      goal: {
        id: "goal-1",
        title: "Goal 1",
        objective: "Ship goal runtime",
        successCriteria: ["Reducer works"],
        constraints: ["Use deterministic ids"],
        evidenceRequired: ["Tests pass"],
        gates: { review: true },
      },
    }, { now: "2026-05-28T00:01:00.000Z" }).state;
  }

  function withVerifierPass(state: GoalState): GoalState {
    state = applyGoalCommand(state, {
      type: "request_completion",
      targetType: "goal",
      targetId: "goal-1",
    }, { now: T2 }).state;
    return applyGoalCommand(state, {
      type: "record_verifier_result",
      receipt: passReceipt(state.goals[0]),
    }, { now: T3 }).state;
  }

  function withReviewPanel(state: GoalState): GoalState {
    return applyGoalCommand(state, {
      type: "open_panel",
      panel: { panelId: REVIEW_PANEL_ID, purpose: "Goal-completion review (security / qa)", expectedMembers: REVIEW_MEMBERS },
    }, { now: T4 }).state;
  }

  function recordReviewVerdict(state: GoalState, member: string, verdict: "APPROVE" | "REJECT", now: string): GoalState {
    return applyGoalCommand(state, {
      type: "record_panel_verdict",
      panelId: REVIEW_PANEL_ID,
      member,
      verdict,
    }, { now }).state;
  }

  it("exports the stable review panel id", () => {
    expect(REVIEW_PANEL_ID).toBe("goal-review-panel");
  });

  it("throws without an approved review panel", () => {
    const state = withVerifierPass(createReviewGatedGoal());

    expect(() => applyGoalCommand(state, {
      type: "complete_target",
      targetType: "goal",
      targetId: "goal-1",
    }, { now: T4 })).toThrow(/review panel is not fully approved/);
  });

  it("throws with a partial review panel", () => {
    let state = withReviewPanel(withVerifierPass(createReviewGatedGoal()));
    state = recordReviewVerdict(state, "security-reviewer", "APPROVE", T5);

    expect(() => applyGoalCommand(state, {
      type: "complete_target",
      targetType: "goal",
      targetId: "goal-1",
    }, { now: T6 })).toThrow(/review panel is not fully approved/);
  });

  it("throws with a REJECT in the review panel", () => {
    let state = withReviewPanel(withVerifierPass(createReviewGatedGoal()));
    state = recordReviewVerdict(state, "security-reviewer", "APPROVE", T5);
    state = recordReviewVerdict(state, "qa-reviewer", "REJECT", T6);

    expect(() => applyGoalCommand(state, {
      type: "complete_target",
      targetType: "goal",
      targetId: "goal-1",
    }, { now: T7 })).toThrow(/review panel is not fully approved/);
  });

  it("completes with an all-APPROVE review panel", () => {
    let state = withReviewPanel(withVerifierPass(createReviewGatedGoal()));
    state = recordReviewVerdict(state, "security-reviewer", "APPROVE", T5);
    state = recordReviewVerdict(state, "qa-reviewer", "APPROVE", T6);
    state = applyGoalCommand(state, {
      type: "complete_target",
      targetType: "goal",
      targetId: "goal-1",
    }, { now: T7 }).state;

    expect(state.goals[0].status).toBe("completed");
    expect(state.status).toBe("completed");
  });

  it("flag absent: completes on verifier PASS alone with NO review panel (golden)", () => {
    let state = withVerifierPass(createGoal());
    state = applyGoalCommand(state, {
      type: "complete_target",
      targetType: "goal",
      targetId: "goal-1",
    }, { now: T4 }).state;

    expect(state.goals[0].gates).toBeUndefined();
    expect(state.goals[0].status).toBe("completed");
    expect(state.panels).toEqual([]);
  });

  it("verifier still required first: an all-APPROVE review panel alone does not complete", () => {
    let state = withReviewPanel(createReviewGatedGoal());
    state = recordReviewVerdict(state, "security-reviewer", "APPROVE", T5);
    state = recordReviewVerdict(state, "qa-reviewer", "APPROVE", T6);

    expect(() => applyGoalCommand(state, {
      type: "complete_target",
      targetType: "goal",
      targetId: "goal-1",
    }, { now: T7 })).toThrow(/latest verifier receipt is not PASS/);
  });
});
