import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildGoalObjectiveHash,
  createGoalState,
  isPanelApproved,
  type GoalValidatorReceipt,
  type GoalVerifierReceipt,
} from "../goal-state.js";
import {
  createGoalStateReplayEvent,
  extractGoalStateReplayEventsFromSessionEntries,
  GOAL_STATE_EVENT_CUSTOM_TYPE,
  replayGoalStateEvents,
  restoreGoalStateFromSnapshotAndEvents,
  sortGoalStateReplayEvents,
  type GoalStateReplayEvent,
} from "../goal-events.js";
import {
  createGoalStateSnapshot,
  goalStateSnapshotPath,
  writeGoalStateSnapshot,
} from "../goal-storage.js";

const START = "2026-05-28T00:00:00.000Z";
const T1 = "2026-05-28T00:01:00.000Z";
const T2 = "2026-05-28T00:02:00.000Z";
const T3 = "2026-05-28T00:03:00.000Z";
const T4 = "2026-05-28T00:04:00.000Z";
const T5 = "2026-05-28T00:05:00.000Z";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "goal-events-"));
  tempDirs.push(dir);
  return dir;
}

function createGoalEvent(id: string, createdAt: string, runId = "run-1"): GoalStateReplayEvent {
  return createGoalStateReplayEvent(runId, {
    type: "create_goal",
    goal: { id, title: `Goal ${id}`, objective: `Objective ${id}` },
  }, { now: createdAt });
}

describe("goal-events", () => {
  it("creates goal-state-event records", () => {
    const event = createGoalEvent("goal-1", T1);

    expect(event).toEqual({
      runId: "run-1",
      createdAt: T1,
      command: {
        type: "create_goal",
        goal: { id: "goal-1", title: "Goal goal-1", objective: "Objective goal-1" },
      },
    });
  });

  it("sorts replay events by creation time", () => {
    const events = [createGoalEvent("goal-2", T2), createGoalEvent("goal-1", T1)];

    expect(sortGoalStateReplayEvents(events).map((event) => event.command.type === "create_goal" ? event.command.goal.id : "other")).toEqual([
      "goal-1",
      "goal-2",
    ]);
  });

  it("replays events in order", () => {
    const result = replayGoalStateEvents(createGoalState("run-1", START), [
      createGoalEvent("goal-2", T2),
      createGoalEvent("goal-1", T1),
    ]);

    expect(result.errors).toEqual([]);
    expect(result.state.goals.map((goal) => goal.id)).toEqual(["goal-1", "goal-2"]);
    expect(result.state.updatedAt).toBe(T2);
  });

  it("restores from snapshot and applies later events", async () => {
    const root = await makeTempDir();
    const baseResult = replayGoalStateEvents(createGoalState("run-1", START), [createGoalEvent("goal-1", T1)]);
    await writeGoalStateSnapshot(
      goalStateSnapshotPath(root, "run-1"),
      createGoalStateSnapshot(baseResult.state, { now: T2 }),
    );

    const result = await restoreGoalStateFromSnapshotAndEvents(root, "run-1", [
      createGoalEvent("stale-goal", T1),
      createGoalEvent("goal-2", T3),
    ]);

    expect(result.errors).toEqual([]);
    expect(result.state.goals.map((goal) => goal.id)).toEqual(["goal-1", "goal-2"]);
  });

  it("ignores malformed events safely with explicit errors", () => {
    const result = replayGoalStateEvents(createGoalState("run-1", START), [
      { runId: "run-1", command: { type: "create_goal" }, createdAt: T1 },
      createGoalEvent("goal-1", T2),
      createGoalEvent("other-goal", T3, "other-run"),
      createGoalEvent("goal-1", T3),
    ]);

    expect(result.state.goals.map((goal) => goal.id)).toEqual(["goal-1"]);
    expect(result.errors).toEqual([
      "Ignored invalid goal-state-event at index 0",
      "Ignored goal-state-event at 2026-05-28T00:03:00.000Z: Goal goal-1 already exists",
    ]);
  });

  it("replays clear_state events", () => {
    const result = replayGoalStateEvents(createGoalState("run-1", START), [
      createGoalEvent("goal-1", T1),
      createGoalStateReplayEvent("run-1", { type: "clear_state" }, { now: T2 }),
    ]);

    expect(result.errors).toEqual([]);
    expect(result.state.goals).toEqual([]);
    expect(result.state.ledger.at(-1)?.type).toBe("goal_cleared");
  });

  it("extracts valid custom replay events and ignores unrelated entries", () => {
    const valid = createGoalEvent("goal-1", T1);
    const entries = [
      { type: "custom", customType: GOAL_STATE_EVENT_CUSTOM_TYPE, data: valid },
      { type: "custom", customType: "other", data: valid },
      { type: "message", data: valid },
      { type: "custom", customType: GOAL_STATE_EVENT_CUSTOM_TYPE, data: { ...valid, createdAt: 123 } },
      null,
    ];

    expect(extractGoalStateReplayEventsFromSessionEntries(entries)).toEqual([valid]);
  });

  it("replays new panel commands and a gates-carrying create_goal round-trip", () => {
    const result = replayGoalStateEvents(createGoalState("run-1", START), [
      createGoalStateReplayEvent("run-1", {
        type: "create_goal",
        goal: { id: "goal-1", title: "Gated goal", objective: "Ship it", gates: { panel: true } },
      }, { now: T1 }),
      createGoalStateReplayEvent("run-1", {
        type: "open_panel",
        panel: { panelId: "panel-1", purpose: "activation review", expectedMembers: ["a", "b"] },
      }, { now: T2 }),
      createGoalStateReplayEvent("run-1", {
        type: "record_panel_verdict",
        panelId: "panel-1",
        member: "a",
        verdict: "APPROVE",
      }, { now: T3 }),
      createGoalStateReplayEvent("run-1", {
        type: "record_panel_verdict",
        panelId: "panel-1",
        member: "b",
        verdict: "APPROVE",
        findings: "looks good",
      }, { now: T4 }),
      createGoalStateReplayEvent("run-1", {
        type: "activate_goal_gated",
        goalId: "goal-1",
        panelId: "panel-1",
      }, { now: T5 }),
    ]);

    expect(result.errors).toEqual([]);
    expect(result.state.goals[0].status).toBe("active");
    expect(result.state.activeGoalId).toBe("goal-1");
    expect(result.state.goals[0].gates).toEqual({ panel: true });
    expect(result.state.panels[0].verdicts.map((verdict) => [verdict.member, verdict.verdict])).toEqual([
      ["a", "APPROVE"],
      ["b", "APPROVE"],
    ]);
    expect(result.state.ledger.at(-1)?.type).toBe("goal_activated_gated");
  });

  it("replays a pre-gates golden log unchanged", () => {
    const createEvent = createGoalStateReplayEvent("run-1", {
      type: "create_goal",
      goal: { id: "goal-1", title: "Legacy goal", objective: "Legacy objective" },
    }, { now: T1 });
    const activateEvent = createGoalStateReplayEvent("run-1", { type: "activate_goal", goalId: "goal-1" }, { now: T2 });
    const requestEvent = createGoalStateReplayEvent("run-1", {
      type: "request_completion",
      targetType: "goal",
      targetId: "goal-1",
    }, { now: T3 });

    const partial = replayGoalStateEvents(createGoalState("run-1", START), [createEvent, activateEvent, requestEvent]);
    expect(partial.errors).toEqual([]);
    const receipt: GoalVerifierReceipt = {
      id: "receipt-1",
      targetType: "goal",
      targetId: "goal-1",
      objectiveHash: buildGoalObjectiveHash(partial.state.goals[0]),
      verdict: "PASS",
      verifiedAt: T4,
      verifierAgent: "reviewer-verifier",
      summary: "Verified",
      blockers: [],
      commandsRun: ["npm test"],
      evidence: ["Tests pass"],
      rawOutput: "Verdict: PASS\nSummary: Verified",
    };

    const result = replayGoalStateEvents(createGoalState("run-1", START), [
      createEvent,
      activateEvent,
      requestEvent,
      createGoalStateReplayEvent("run-1", { type: "record_verifier_result", receipt }, { now: T4 }),
      createGoalStateReplayEvent("run-1", { type: "complete_target", targetType: "goal", targetId: "goal-1" }, { now: T5 }),
    ]);

    expect(result.errors).toEqual([]);
    expect(result.state.goals[0].status).toBe("completed");
    expect(result.state.goals[0].gates).toBeUndefined();
  });

  it("resumes mid-panel from a snapshot plus a later verdict event", async () => {
    const root = await makeTempDir();
    const base = replayGoalStateEvents(createGoalState("run-1", START), [
      createGoalStateReplayEvent("run-1", {
        type: "create_goal",
        goal: { id: "goal-1", title: "Gated goal", objective: "Ship it" },
      }, { now: T1 }),
      createGoalStateReplayEvent("run-1", {
        type: "open_panel",
        panel: { panelId: "panel-1", purpose: "activation review", expectedMembers: ["a", "b"] },
      }, { now: T2 }),
      createGoalStateReplayEvent("run-1", {
        type: "record_panel_verdict",
        panelId: "panel-1",
        member: "a",
        verdict: "APPROVE",
      }, { now: T3 }),
    ]);
    expect(base.errors).toEqual([]);
    await writeGoalStateSnapshot(
      goalStateSnapshotPath(root, "run-1"),
      createGoalStateSnapshot(base.state, { now: T3 }),
    );

    const result = await restoreGoalStateFromSnapshotAndEvents(root, "run-1", [
      createGoalStateReplayEvent("run-1", {
        type: "record_panel_verdict",
        panelId: "panel-1",
        member: "b",
        verdict: "APPROVE",
      }, { now: T4 }),
    ]);

    expect(result.errors).toEqual([]);
    expect(result.state.panels[0].verdicts).toHaveLength(2);
    expect(isPanelApproved(result.state.panels[0])).toBe(true);
  });

  it("restores a pre-panels snapshot through the real path without throwing", async () => {
    const root = await makeTempDir();
    const path = goalStateSnapshotPath(root, "run-1");
    const legacySnapshot = {
      schemaVersion: 1,
      state: {
        schemaVersion: 1,
        runId: "run-1",
        status: "idle",
        goals: [
          {
            id: "goal-1",
            title: "Legacy goal",
            objective: "Legacy objective",
            status: "queued",
            priority: "medium",
            successCriteria: [],
            constraints: [],
            evidenceRequired: [],
            evidence: [],
            subgoals: [],
            verifierReceipts: [],
            blockers: [],
            createdAt: T1,
            updatedAt: T1,
          },
        ],
        ledger: [
          { seq: 1, type: "goal_created", goalId: "goal-1", message: "Created goal goal-1", createdAt: T1 },
        ],
        continuation: { queued: false, blockers: [], consecutiveFailures: {} },
        createdAt: START,
        updatedAt: T1,
      },
      snapshotSeq: 1,
      writtenAt: T2,
    };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(legacySnapshot, null, 2)}\n`, "utf8");

    const result = await restoreGoalStateFromSnapshotAndEvents(root, "run-1", [
      createGoalStateReplayEvent("run-1", { type: "activate_goal", goalId: "goal-1" }, { now: T3 }),
    ]);

    expect(result.errors).toEqual([]);
    expect(result.state.panels).toEqual([]);
    expect(result.state.goals[0].status).toBe("active");
  });

  it("replays a pre-validator-era log through the verifier path unchanged", () => {
    const createEvent = createGoalStateReplayEvent("run-1", {
      type: "create_goal",
      goal: { id: "goal-1", title: "Legacy goal", objective: "Legacy objective" },
    }, { now: T1 });
    const subgoalEvent = createGoalStateReplayEvent("run-1", {
      type: "create_subgoal",
      subgoal: { id: "subgoal-1", goalId: "goal-1", title: "Legacy subgoal", objective: "Legacy subgoal objective" },
    }, { now: T2 });
    const requestEvent = createGoalStateReplayEvent("run-1", {
      type: "request_completion",
      targetType: "subgoal",
      targetId: "subgoal-1",
    }, { now: T3 });

    const partial = replayGoalStateEvents(createGoalState("run-1", START), [createEvent, subgoalEvent, requestEvent]);
    expect(partial.errors).toEqual([]);
    const receipt: GoalVerifierReceipt = {
      id: "receipt-1",
      targetType: "subgoal",
      targetId: "subgoal-1",
      objectiveHash: buildGoalObjectiveHash(partial.state.goals[0], partial.state.goals[0].subgoals[0]),
      verdict: "PASS",
      verifiedAt: T4,
      verifierAgent: "reviewer-verifier",
      summary: "Verified",
      blockers: [],
      commandsRun: ["npm test"],
      evidence: ["Tests pass"],
      rawOutput: "Verdict: PASS\nSummary: Verified",
    };

    const result = replayGoalStateEvents(createGoalState("run-1", START), [
      createEvent,
      subgoalEvent,
      requestEvent,
      createGoalStateReplayEvent("run-1", { type: "record_verifier_result", receipt }, { now: T4 }),
      createGoalStateReplayEvent("run-1", { type: "complete_target", targetType: "subgoal", targetId: "subgoal-1" }, { now: T5 }),
    ]);

    expect(result.errors).toEqual([]);
    expect(result.state.goals[0].subgoals[0].status).toBe("completed");
  });

  it("round-trips a validator receipt through replay", () => {
    const createEvent = createGoalStateReplayEvent("run-1", {
      type: "create_goal",
      goal: { id: "goal-1", title: "Gated goal", objective: "Ship it", gates: { validator: true } },
    }, { now: T1 });
    const subgoalEvent = createGoalStateReplayEvent("run-1", {
      type: "create_subgoal",
      subgoal: { id: "subgoal-1", goalId: "goal-1", title: "Gated subgoal", objective: "Subgoal objective" },
    }, { now: T2 });
    const requestEvent = createGoalStateReplayEvent("run-1", {
      type: "request_completion",
      targetType: "subgoal",
      targetId: "subgoal-1",
    }, { now: T3 });

    const partial = replayGoalStateEvents(createGoalState("run-1", START), [createEvent, subgoalEvent, requestEvent]);
    expect(partial.errors).toEqual([]);
    const receipt: GoalValidatorReceipt = {
      id: "vr-1",
      targetType: "subgoal",
      targetId: "subgoal-1",
      objectiveHash: buildGoalObjectiveHash(partial.state.goals[0], partial.state.goals[0].subgoals[0]),
      verdict: "PASS",
      recordedAt: T4,
      validatorAgent: "plan-validator",
      summary: "Validated",
      blockers: [],
      commandsRun: ["npm test"],
      evidence: ["Tests pass"],
      rawOutput: "Verdict: PASS\nSummary: Validated",
    };

    const result = replayGoalStateEvents(createGoalState("run-1", START), [
      createEvent,
      subgoalEvent,
      requestEvent,
      createGoalStateReplayEvent("run-1", { type: "record_validator_receipt", receipt }, { now: T4 }),
      createGoalStateReplayEvent("run-1", { type: "complete_target", targetType: "subgoal", targetId: "subgoal-1" }, { now: T5 }),
    ]);

    expect(result.errors).toEqual([]);
    expect(result.state.goals[0].subgoals[0].status).toBe("completed");
    expect(result.state.goals[0].subgoals[0].validatorReceipts).toHaveLength(1);
    expect(result.state.ledger.some((entry) => entry.type === "validator_pass")).toBe(true);
  });

  it("rejects a record_validator_receipt carrying the verifier identity", () => {
    const result = replayGoalStateEvents(createGoalState("run-1", START), [
      {
        runId: "run-1",
        createdAt: T1,
        command: {
          type: "record_validator_receipt",
          receipt: {
            id: "vr-bad",
            targetType: "subgoal",
            targetId: "subgoal-1",
            objectiveHash: "hash",
            verdict: "PASS",
            recordedAt: T1,
            validatorAgent: "reviewer-verifier",
            summary: "wrong identity",
            blockers: [],
            commandsRun: [],
            evidence: [],
            rawOutput: "",
          },
        },
      },
    ]);

    expect(result.errors).toEqual(["Ignored invalid goal-state-event at index 0"]);
    expect(result.state.goals).toEqual([]);
  });

  it("rejects a record_verifier_result carrying the validator identity", () => {
    const result = replayGoalStateEvents(createGoalState("run-1", START), [
      {
        runId: "run-1",
        createdAt: T1,
        command: {
          type: "record_verifier_result",
          receipt: {
            id: "receipt-bad",
            targetType: "subgoal",
            targetId: "subgoal-1",
            objectiveHash: "hash",
            verdict: "PASS",
            verifiedAt: T1,
            verifierAgent: "plan-validator",
            summary: "wrong identity",
            blockers: [],
            commandsRun: [],
            evidence: [],
            rawOutput: "",
          },
        },
      },
    ]);

    expect(result.errors).toEqual(["Ignored invalid goal-state-event at index 0"]);
    expect(result.state.goals).toEqual([]);
  });

  it("rejects create_goal events with malformed gates", () => {
    const result = replayGoalStateEvents(createGoalState("run-1", START), [
      {
        runId: "run-1",
        createdAt: T1,
        command: {
          type: "create_goal",
          goal: { id: "goal-1", title: "Bad gates", objective: "Objective", gates: { panel: "yes" } },
        },
      },
    ]);

    expect(result.errors).toEqual(["Ignored invalid goal-state-event at index 0"]);
    expect(result.state.goals).toEqual([]);
  });
});
