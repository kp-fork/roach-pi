import { createHash } from "node:crypto";

export const GOAL_STATE_SCHEMA_VERSION = 1;

export type GoalRunStatus = "idle" | "active" | "paused" | "completed" | "failed" | "cancelled";
export type GoalStatus = "queued" | "active" | "blocked" | "verifying" | "completed" | "failed" | "cancelled";
export type SubgoalStatus = "queued" | "active" | "implemented" | "verifying" | "completed" | "failed" | "blocked" | "cancelled";
export type GoalPriority = "high" | "medium" | "low";

export interface GoalContinuationState {
  queued: boolean;
  targetType?: "goal" | "subgoal";
  targetId?: string;
  reason?: string;
  blockers: string[];
  consecutiveFailures: Record<string, number>;
  leaseId?: string;
  updatedAt?: string;
}

export type PanelVerdict = "APPROVE" | "REJECT";

export interface PanelMemberVerdict {
  member: string;
  verdict: PanelVerdict;
  findings?: string;
  recordedAt: string;
}

export interface PanelState {
  panelId: string;
  purpose: string;
  expectedMembers: string[];
  round: number;
  verdicts: PanelMemberVerdict[];
}

export interface GoalGates {
  panel?: boolean;
  validator?: boolean;
  review?: boolean;
}

export interface GoalState {
  schemaVersion: 1;
  runId: string;
  status: GoalRunStatus;
  activeGoalId?: string;
  goals: GoalItem[];
  panels: PanelState[];
  ledger: GoalLedgerEntry[];
  continuation: GoalContinuationState;
  createdAt: string;
  updatedAt: string;
}

export interface GoalItem {
  id: string;
  title: string;
  objective: string;
  status: GoalStatus;
  priority: GoalPriority;
  successCriteria: string[];
  constraints: string[];
  evidenceRequired: string[];
  evidence: string[];
  subgoals: SubgoalItem[];
  activeSubgoalId?: string;
  verifierReceipts: GoalVerifierReceipt[];
  blockers: string[];
  gates?: GoalGates;
  createdAt: string;
  updatedAt: string;
}

export interface SubgoalItem {
  id: string;
  goalId: string;
  title: string;
  objective: string;
  status: SubgoalStatus;
  dependencies: string[];
  evidence: string[];
  attempts: number;
  verifierReceipts: GoalVerifierReceipt[];
  validatorReceipts?: GoalValidatorReceipt[]; // optional; absent ⇒ ungated
  blockers: string[];
  createdAt: string;
  updatedAt: string;
}

export interface GoalVerifierReceipt {
  id: string;
  targetType: "goal" | "subgoal";
  targetId: string;
  objectiveHash: string;
  verdict: "PASS" | "FAIL";
  verifiedAt: string;
  verifierAgent: "reviewer-verifier";
  summary: string;
  blockers: string[];
  commandsRun: string[];
  evidence: string[];
  rawOutput: string;
}

export const GOAL_VALIDATOR_AGENT = "plan-validator" as const;

export interface GoalValidatorReceipt {
  id: string;
  targetType: "subgoal"; // validator gate is subgoal-only; goal-level stays verifier
  targetId: string;
  objectiveHash: string;
  verdict: "PASS" | "FAIL";
  recordedAt: string; // distinct from GoalVerifierReceipt.verifiedAt
  validatorAgent: typeof GOAL_VALIDATOR_AGENT;
  summary: string;
  blockers: string[];
  commandsRun: string[];
  evidence: string[];
  rawOutput: string;
}

export interface GoalLedgerEntry {
  seq: number;
  type:
    | "goal_created"
    | "goal_activated"
    | "panel_opened"
    | "panel_verdict_recorded"
    | "goal_activated_gated"
    | "subgoal_created"
    | "evidence_added"
    | "completion_requested"
    | "verifier_started"
    | "verifier_pass"
    | "verifier_fail"
    | "validator_pass"
    | "validator_fail"
    | "continuation_queued"
    | "goal_completed"
    | "goal_paused"
    | "goal_resumed"
    | "goal_cancelled"
    | "goal_cleared";
  goalId?: string;
  subgoalId?: string;
  message: string;
  createdAt: string;
  data?: Record<string, unknown>;
}

export type GoalCommand =
  | {
      type: "create_goal";
      goal: {
        id: string;
        title: string;
        objective: string;
        priority?: GoalPriority;
        successCriteria?: string[];
        constraints?: string[];
        evidenceRequired?: string[];
        gates?: GoalGates;
      };
    }
  | { type: "activate_goal"; goalId: string }
  | { type: "open_panel"; panel: { panelId: string; purpose: string; expectedMembers: string[] } }
  | { type: "record_panel_verdict"; panelId: string; member: string; verdict: PanelVerdict; findings?: string }
  | { type: "activate_goal_gated"; goalId: string; panelId: string }
  | {
      type: "create_subgoal";
      subgoal: {
        id: string;
        goalId: string;
        title: string;
        objective: string;
        dependencies?: string[];
      };
    }
  | { type: "add_evidence"; targetType: "goal" | "subgoal"; targetId: string; evidence: string }
  | { type: "request_completion"; targetType: "goal" | "subgoal"; targetId: string }
  | { type: "record_verifier_result"; receipt: GoalVerifierReceipt }
  | { type: "record_validator_receipt"; receipt: GoalValidatorReceipt }
  | { type: "complete_target"; targetType: "goal" | "subgoal"; targetId: string }
  | { type: "pause_goal"; goalId?: string }
  | { type: "resume_goal"; goalId?: string }
  | { type: "cancel_goal"; goalId?: string }
  | { type: "clear_state" }
  | {
      type: "queue_continuation";
      targetType?: "goal" | "subgoal";
      targetId?: string;
      reason: string;
      blockers?: string[];
      leaseId?: string;
    }
  | { type: "clear_continuation" };

export interface GoalReducerResult {
  state: GoalState;
  ledgerEntry?: GoalLedgerEntry;
}

export class GoalInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoalInvariantError";
  }
}

export const REVIEW_PANEL_ID = "goal-review-panel";

export function isPanelApproved(panel: PanelState): boolean {
  if (panel.expectedMembers.length === 0) return false; // fail-closed: empty panel never approves
  return panel.expectedMembers.every(
    (member) => panel.verdicts.find((v) => v.member === member)?.verdict === "APPROVE",
  );
}

export function createGoalState(runId: string, now: string): GoalState {
  return {
    schemaVersion: GOAL_STATE_SCHEMA_VERSION,
    runId,
    status: "idle",
    goals: [],
    panels: [],
    ledger: [],
    continuation: {
      queued: false,
      blockers: [],
      consecutiveFailures: {},
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function applyGoalCommand(
  state: GoalState,
  command: GoalCommand,
  options: { now: string },
): GoalReducerResult {
  const now = options.now;
  const next = cloneState(state);
  next.updatedAt = now;

  switch (command.type) {
    case "create_goal": {
      if (next.goals.some((goal) => goal.id === command.goal.id)) {
        throw new Error(`Goal ${command.goal.id} already exists`);
      }
      const goal: GoalItem = {
        id: command.goal.id,
        title: command.goal.title,
        objective: command.goal.objective,
        status: "queued",
        priority: command.goal.priority ?? "medium",
        successCriteria: [...(command.goal.successCriteria ?? [])],
        constraints: [...(command.goal.constraints ?? [])],
        evidenceRequired: [...(command.goal.evidenceRequired ?? [])],
        evidence: [],
        subgoals: [],
        verifierReceipts: [],
        blockers: [],
        gates: command.goal.gates ? { ...command.goal.gates } : undefined,
        createdAt: now,
        updatedAt: now,
      };
      next.goals.push(goal);
      return withLedger(next, {
        type: "goal_created",
        goalId: goal.id,
        message: `Created goal ${goal.id}`,
        createdAt: now,
      });
    }

    case "activate_goal": {
      const goal = getGoal(next, command.goalId);
      next.goals = next.goals.map((candidate) => ({
        ...candidate,
        status: candidate.id === goal.id ? "active" : candidate.status === "active" ? "queued" : candidate.status,
        updatedAt: candidate.id === goal.id ? now : candidate.updatedAt,
      }));
      next.status = "active";
      next.activeGoalId = goal.id;
      return withLedger(next, {
        type: "goal_activated",
        goalId: goal.id,
        message: `Activated goal ${goal.id}`,
        createdAt: now,
      });
    }

    case "open_panel": {
      next.panels = next.panels ?? [];
      const existing = next.panels.find((panel) => panel.panelId === command.panel.panelId);
      let round: number;
      if (existing) {
        existing.round += 1;
        existing.purpose = command.panel.purpose;
        existing.expectedMembers = [...command.panel.expectedMembers];
        existing.verdicts = [];
        round = existing.round;
      } else {
        next.panels.push({
          panelId: command.panel.panelId,
          purpose: command.panel.purpose,
          expectedMembers: [...command.panel.expectedMembers],
          round: 1,
          verdicts: [],
        });
        round = 1;
      }
      return withLedger(next, {
        type: "panel_opened",
        message: `Opened panel ${command.panel.panelId} (round ${round})`,
        createdAt: now,
        data: { panelId: command.panel.panelId, round },
      });
    }

    case "record_panel_verdict": {
      const panel = (next.panels ?? []).find((candidate) => candidate.panelId === command.panelId);
      if (!panel) {
        throw new Error(`Panel ${command.panelId} not found`);
      }
      const verdict: PanelMemberVerdict = {
        member: command.member,
        verdict: command.verdict,
        findings: command.findings,
        recordedAt: now,
      };
      const index = panel.verdicts.findIndex((candidate) => candidate.member === command.member);
      if (index >= 0) {
        panel.verdicts[index] = verdict;
      } else {
        panel.verdicts.push(verdict);
      }
      return withLedger(next, {
        type: "panel_verdict_recorded",
        message: `Panel ${command.panelId}: ${command.member} voted ${command.verdict}`,
        createdAt: now,
        data: { panelId: command.panelId, member: command.member, verdict: command.verdict },
      });
    }

    case "activate_goal_gated": {
      const goal = getGoal(next, command.goalId);
      const panel = (next.panels ?? []).find((candidate) => candidate.panelId === command.panelId);
      if (!panel) {
        throw new GoalInvariantError(`Cannot activate goal ${goal.id}: panel ${command.panelId} not found`);
      }
      if (!isPanelApproved(panel)) {
        throw new GoalInvariantError(`Cannot activate goal ${goal.id}: panel ${command.panelId} is not fully approved`);
      }
      next.goals = next.goals.map((candidate) => ({
        ...candidate,
        status: candidate.id === goal.id ? "active" : candidate.status === "active" ? "queued" : candidate.status,
        updatedAt: candidate.id === goal.id ? now : candidate.updatedAt,
      }));
      next.status = "active";
      next.activeGoalId = goal.id;
      return withLedger(next, {
        type: "goal_activated_gated",
        goalId: goal.id,
        message: `Activated goal ${goal.id} via panel ${command.panelId}`,
        createdAt: now,
        data: { panelId: command.panelId },
      });
    }

    case "create_subgoal": {
      const goal = getGoal(next, command.subgoal.goalId);
      if (goal.subgoals.some((subgoal) => subgoal.id === command.subgoal.id)) {
        throw new Error(`Subgoal ${command.subgoal.id} already exists`);
      }
      const subgoal: SubgoalItem = {
        id: command.subgoal.id,
        goalId: goal.id,
        title: command.subgoal.title,
        objective: command.subgoal.objective,
        status: goal.activeSubgoalId ? "queued" : "active",
        dependencies: [...(command.subgoal.dependencies ?? [])],
        evidence: [],
        attempts: 0,
        verifierReceipts: [],
        blockers: [],
        createdAt: now,
        updatedAt: now,
      };
      goal.subgoals.push(subgoal);
      goal.activeSubgoalId = goal.activeSubgoalId ?? subgoal.id;
      goal.updatedAt = now;
      return withLedger(next, {
        type: "subgoal_created",
        goalId: goal.id,
        subgoalId: subgoal.id,
        message: `Created subgoal ${subgoal.id}`,
        createdAt: now,
      });
    }

    case "add_evidence": {
      const target = getTarget(next, command.targetType, command.targetId);
      if (target.type === "goal") {
        target.goal.evidence.push(command.evidence);
        target.goal.blockers = [];
        target.goal.updatedAt = now;
      } else {
        target.subgoal.evidence.push(command.evidence);
        target.subgoal.blockers = [];
        target.subgoal.updatedAt = now;
      }
      return withLedger(next, {
        type: "evidence_added",
        goalId: target.goal.id,
        subgoalId: target.type === "subgoal" ? target.subgoal.id : undefined,
        message: command.evidence,
        createdAt: now,
      });
    }

    case "request_completion": {
      const target = getTarget(next, command.targetType, command.targetId);
      if (target.type === "goal") {
        target.goal.status = "verifying";
        target.goal.updatedAt = now;
      } else {
        target.subgoal.status = "verifying";
        target.subgoal.attempts += 1;
        target.subgoal.updatedAt = now;
      }
      return withLedger(next, {
        type: "completion_requested",
        goalId: target.goal.id,
        subgoalId: target.type === "subgoal" ? target.subgoal.id : undefined,
        message: `Completion requested for ${command.targetType} ${command.targetId}`,
        createdAt: now,
      });
    }

    case "record_verifier_result": {
      const target = getTarget(next, command.receipt.targetType, command.receipt.targetId);
      if (target.type === "goal") {
        target.goal.verifierReceipts.push(cloneReceipt(command.receipt));
        target.goal.status = command.receipt.verdict === "PASS" ? "verifying" : "blocked";
        target.goal.blockers = [...command.receipt.blockers];
        target.goal.updatedAt = now;
      } else {
        target.subgoal.verifierReceipts.push(cloneReceipt(command.receipt));
        target.subgoal.status = command.receipt.verdict === "PASS" ? "verifying" : "blocked";
        target.subgoal.blockers = [...command.receipt.blockers];
        target.subgoal.updatedAt = now;
      }
      bumpFailureBudget(next, target.goal, target.type === "goal" ? target.goal.id : target.subgoal.id, command.receipt.verdict);
      const ledgerType = command.receipt.verdict === "PASS" ? "verifier_pass" : "verifier_fail";
      return withLedger(next, {
        type: ledgerType,
        goalId: target.goal.id,
        subgoalId: target.type === "subgoal" ? target.subgoal.id : undefined,
        message: command.receipt.summary,
        createdAt: now,
        data: { receiptId: command.receipt.id },
      });
    }

    case "record_validator_receipt": {
      const target = getTarget(next, command.receipt.targetType, command.receipt.targetId);
      if (target.type !== "subgoal") {
        throw new Error(`Validator receipt target ${command.receipt.targetId} is not a subgoal`);
      }
      target.subgoal.validatorReceipts = [...(target.subgoal.validatorReceipts ?? []), cloneValidatorReceipt(command.receipt)];
      target.subgoal.status = command.receipt.verdict === "PASS" ? "verifying" : "blocked";
      target.subgoal.blockers = [...command.receipt.blockers];
      target.subgoal.updatedAt = now;
      bumpFailureBudget(next, target.goal, target.subgoal.id, command.receipt.verdict);
      const ledgerType = command.receipt.verdict === "PASS" ? "validator_pass" : "validator_fail";
      return withLedger(next, {
        type: ledgerType,
        goalId: target.goal.id,
        subgoalId: target.subgoal.id,
        message: command.receipt.summary,
        createdAt: now,
        data: { receiptId: command.receipt.id },
      });
    }

    case "complete_target": {
      const target = getTarget(next, command.targetType, command.targetId);
      assertCompletionInvariant(next, target);
      if (target.type === "goal") {
        target.goal.status = "completed";
        target.goal.updatedAt = now;
        if (next.activeGoalId === target.goal.id) {
          const nextGoal = next.goals.find((goal) => goal.status === "queued");
          if (nextGoal) {
            nextGoal.status = "active";
            nextGoal.updatedAt = now;
            next.activeGoalId = nextGoal.id;
            next.status = "active";
          }
        }
      } else {
        target.subgoal.status = "completed";
        target.subgoal.updatedAt = now;
        activateNextRunnableSubgoal(target.goal, now);
      }
      if (next.goals.length > 0 && next.goals.every((goal) => goal.status === "completed")) {
        next.status = "completed";
        delete next.activeGoalId;
      }
      return withLedger(next, {
        type: "goal_completed",
        goalId: target.goal.id,
        subgoalId: target.type === "subgoal" ? target.subgoal.id : undefined,
        message: `Completed ${command.targetType} ${command.targetId}`,
        createdAt: now,
      });
    }

    case "pause_goal": {
      const goal = getGoal(next, command.goalId ?? next.activeGoalId ?? "");
      goal.status = "blocked";
      goal.updatedAt = now;
      next.status = "paused";
      return withLedger(next, {
        type: "goal_paused",
        goalId: goal.id,
        message: `Paused goal ${goal.id}`,
        createdAt: now,
      });
    }

    case "resume_goal": {
      const goal = getGoal(next, command.goalId ?? next.activeGoalId ?? "");
      goal.status = "active";
      goal.updatedAt = now;
      next.status = "active";
      next.activeGoalId = goal.id;
      return withLedger(next, {
        type: "goal_resumed",
        goalId: goal.id,
        message: `Resumed goal ${goal.id}`,
        createdAt: now,
      });
    }

    case "cancel_goal": {
      const goal = getGoal(next, command.goalId ?? next.activeGoalId ?? "");
      goal.status = "cancelled";
      goal.updatedAt = now;
      if (next.activeGoalId === goal.id) {
        delete next.activeGoalId;
      }
      if (next.goals.every((candidate) => candidate.status === "cancelled" || candidate.status === "completed")) {
        next.status = "cancelled";
      }
      return withLedger(next, {
        type: "goal_cancelled",
        goalId: goal.id,
        message: `Cancelled goal ${goal.id}`,
        createdAt: now,
      });
    }

    case "clear_state": {
      return withLedger(createGoalState(next.runId, now), {
        type: "goal_cleared",
        message: "Cleared goal runtime state",
        createdAt: now,
      });
    }

    case "queue_continuation": {
      next.continuation = {
        ...next.continuation,
        queued: true,
        targetType: command.targetType,
        targetId: command.targetId,
        reason: command.reason,
        blockers: [...(command.blockers ?? [])],
        leaseId: command.leaseId,
        updatedAt: now,
      };
      return withLedger(next, {
        type: "continuation_queued",
        message: command.reason,
        createdAt: now,
        data: { targetType: command.targetType, targetId: command.targetId },
      });
    }

    case "clear_continuation": {
      next.continuation = {
        queued: false,
        blockers: [],
        consecutiveFailures: { ...next.continuation.consecutiveFailures },
        updatedAt: now,
      };
      return { state: next };
    }
  }
}

function cloneState(state: GoalState): GoalState {
  return {
    ...state,
    goals: state.goals.map((goal) => ({
      ...goal,
      successCriteria: [...goal.successCriteria],
      constraints: [...goal.constraints],
      evidenceRequired: [...goal.evidenceRequired],
      evidence: [...(goal.evidence ?? [])],
      subgoals: goal.subgoals.map((subgoal) => ({
        ...subgoal,
        dependencies: [...subgoal.dependencies],
        evidence: [...subgoal.evidence],
        verifierReceipts: subgoal.verifierReceipts.map(cloneReceipt),
        validatorReceipts: subgoal.validatorReceipts ? subgoal.validatorReceipts.map(cloneValidatorReceipt) : undefined,
        blockers: [...subgoal.blockers],
      })),
      verifierReceipts: goal.verifierReceipts.map(cloneReceipt),
      blockers: [...goal.blockers],
      gates: goal.gates ? { ...goal.gates } : undefined,
    })),
    panels: (state.panels ?? []).map((panel) => ({
      ...panel,
      expectedMembers: [...panel.expectedMembers],
      verdicts: panel.verdicts.map((v) => ({ ...v })),
    })),
    ledger: state.ledger.map((entry) => ({ ...entry, data: entry.data ? { ...entry.data } : undefined })),
    continuation: {
      ...state.continuation,
      blockers: [...state.continuation.blockers],
      consecutiveFailures: { ...state.continuation.consecutiveFailures },
    },
  };
}

function cloneReceipt(receipt: GoalVerifierReceipt): GoalVerifierReceipt {
  return {
    ...receipt,
    blockers: [...receipt.blockers],
    commandsRun: [...receipt.commandsRun],
    evidence: [...receipt.evidence],
  };
}

function bumpFailureBudget(
  state: GoalState,
  goal: GoalItem,
  targetId: string,
  verdict: "PASS" | "FAIL",
): void {
  if (goal.gates?.validator !== true) return; // fires ONLY for gated goals
  const counters = state.continuation.consecutiveFailures; // `state` is the clone → safe to mutate
  if (verdict === "FAIL") {
    counters[targetId] = (counters[targetId] ?? 0) + 1;
  } else {
    delete counters[targetId];
  }
}

function cloneValidatorReceipt(receipt: GoalValidatorReceipt): GoalValidatorReceipt {
  return {
    ...receipt,
    blockers: [...receipt.blockers],
    commandsRun: [...receipt.commandsRun],
    evidence: [...receipt.evidence],
  };
}

function withLedger(
  state: GoalState,
  entry: Omit<GoalLedgerEntry, "seq">,
): GoalReducerResult {
  const ledgerEntry: GoalLedgerEntry = {
    ...entry,
    seq: state.ledger.length + 1,
  };
  return {
    state: {
      ...state,
      ledger: [...state.ledger, ledgerEntry],
    },
    ledgerEntry,
  };
}

function getGoal(state: GoalState, goalId: string): GoalItem {
  const goal = state.goals.find((candidate) => candidate.id === goalId);
  if (!goal) {
    throw new Error(`Goal ${goalId} not found`);
  }
  return goal;
}

type GoalTarget = { type: "goal"; goal: GoalItem } | { type: "subgoal"; goal: GoalItem; subgoal: SubgoalItem };

function getTarget(state: GoalState, targetType: "goal" | "subgoal", targetId: string): GoalTarget {
  if (targetType === "goal") {
    return { type: "goal", goal: getGoal(state, targetId) };
  }
  for (const goal of state.goals) {
    const subgoal = goal.subgoals.find((candidate) => candidate.id === targetId);
    if (subgoal) {
      return { type: "subgoal", goal, subgoal };
    }
  }
  throw new Error(`Subgoal ${targetId} not found`);
}

export function buildGoalObjectiveHash(goal: GoalItem, subgoal?: SubgoalItem): string {
  const payload = subgoal
    ? {
        targetType: "subgoal",
        targetId: subgoal.id,
        objective: subgoal.objective,
        successCriteria: goal.successCriteria,
        evidenceRequired: goal.evidenceRequired,
        evidence: subgoal.evidence,
      }
    : {
        targetType: "goal",
        targetId: goal.id,
        objective: goal.objective,
        successCriteria: goal.successCriteria,
        evidenceRequired: goal.evidenceRequired,
        evidence: goal.evidence,
      };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function assertCompletionInvariant(state: GoalState, target: GoalTarget): void {
  if (target.type === "subgoal" && target.goal.gates?.validator === true) {
    assertValidatorCompletionInvariant(state, target.goal, target.subgoal);
    return;
  }
  // ---- existing verifier invariant below: unchanged for goal targets and ungated subgoals ----
  const targetType = target.type;
  const targetId = target.type === "goal" ? target.goal.id : target.subgoal.id;
  const receipts = target.type === "goal" ? target.goal.verifierReceipts : target.subgoal.verifierReceipts;
  const latestReceipt = receipts.at(-1);

  if (!latestReceipt || latestReceipt.verdict !== "PASS") {
    throw new GoalInvariantError(`Cannot complete ${targetType} ${targetId}: latest verifier receipt is not PASS`);
  }
  if (latestReceipt.targetType !== targetType || latestReceipt.targetId !== targetId) {
    throw new GoalInvariantError(`Cannot complete ${targetType} ${targetId}: verifier receipt target mismatch`);
  }

  const expectedHash = target.type === "goal"
    ? buildGoalObjectiveHash(target.goal)
    : buildGoalObjectiveHash(target.goal, target.subgoal);
  if (latestReceipt.objectiveHash !== expectedHash) {
    throw new GoalInvariantError(`Cannot complete ${targetType} ${targetId}: verifier receipt objective hash is stale`);
  }

  const verifierPassEntry = [...state.ledger].reverse().find((entry) =>
    entry.type === "verifier_pass"
    && entry.data?.receiptId === latestReceipt.id
    && entryMatchesTarget(entry, targetType, target.goal.id, target.type === "subgoal" ? target.subgoal.id : undefined)
  );
  if (!verifierPassEntry) {
    throw new GoalInvariantError(`Cannot complete ${targetType} ${targetId}: verifier PASS ledger entry is missing`);
  }

  const staleEntry = state.ledger.find((entry) =>
    entry.seq > verifierPassEntry.seq
    && (entry.type === "evidence_added" || entry.type === "subgoal_created" || entry.type === "completion_requested")
    && entryMatchesTarget(entry, targetType, target.goal.id, target.type === "subgoal" ? target.subgoal.id : undefined)
  );
  if (staleEntry) {
    throw new GoalInvariantError(`Cannot complete ${targetType} ${targetId}: verifier receipt is stale after ${staleEntry.type}`);
  }

  // ---- M6 review clause: layered ON TOP of the verifier invariant for review-gated goal targets ----
  if (target.type === "goal" && target.goal.gates?.review === true) {
    const reviewPanel = (state.panels ?? []).find((panel) => panel.panelId === REVIEW_PANEL_ID);
    if (!reviewPanel || !isPanelApproved(reviewPanel)) {
      throw new GoalInvariantError(`Cannot complete goal ${target.goal.id}: review panel is not fully approved`);
    }
  }
}

function assertValidatorCompletionInvariant(state: GoalState, goal: GoalItem, subgoal: SubgoalItem): void {
  const receipts = subgoal.validatorReceipts ?? [];
  const latest = receipts.at(-1);
  if (!latest || latest.verdict !== "PASS") {
    throw new GoalInvariantError(`Cannot complete subgoal ${subgoal.id}: latest validator receipt is not PASS`);
  }
  if (latest.targetType !== "subgoal" || latest.targetId !== subgoal.id) {
    throw new GoalInvariantError(`Cannot complete subgoal ${subgoal.id}: validator receipt target mismatch`);
  }
  const expectedHash = buildGoalObjectiveHash(goal, subgoal);
  if (latest.objectiveHash !== expectedHash) {
    throw new GoalInvariantError(`Cannot complete subgoal ${subgoal.id}: validator receipt objective hash is stale`);
  }
  const passEntry = [...state.ledger].reverse().find((entry) =>
    entry.type === "validator_pass"
    && entry.data?.receiptId === latest.id
    && entryMatchesTarget(entry, "subgoal", goal.id, subgoal.id)
  );
  if (!passEntry) {
    throw new GoalInvariantError(`Cannot complete subgoal ${subgoal.id}: validator PASS ledger entry is missing`);
  }
  const staleEntry = state.ledger.find((entry) =>
    entry.seq > passEntry.seq
    && (entry.type === "evidence_added" || entry.type === "subgoal_created" || entry.type === "completion_requested")
    && entryMatchesTarget(entry, "subgoal", goal.id, subgoal.id)
  );
  if (staleEntry) {
    throw new GoalInvariantError(`Cannot complete subgoal ${subgoal.id}: validator receipt is stale after ${staleEntry.type}`);
  }
}

function entryMatchesTarget(
  entry: GoalLedgerEntry,
  targetType: "goal" | "subgoal",
  goalId: string,
  subgoalId: string | undefined,
): boolean {
  if (targetType === "goal") {
    return entry.goalId === goalId && entry.subgoalId === undefined;
  }
  return entry.goalId === goalId && entry.subgoalId === subgoalId;
}

function activateNextRunnableSubgoal(goal: GoalItem, now: string): void {
  if (goal.activeSubgoalId && goal.subgoals.some((subgoal) => subgoal.id === goal.activeSubgoalId && subgoal.status !== "completed")) {
    return;
  }
  const nextSubgoal = goal.subgoals.find((subgoal) =>
    subgoal.status === "queued" && subgoal.dependencies.every((dependencyId) =>
      goal.subgoals.some((candidate) => candidate.id === dependencyId && candidate.status === "completed")
    )
  );
  if (nextSubgoal) {
    nextSubgoal.status = "active";
    nextSubgoal.updatedAt = now;
    goal.activeSubgoalId = nextSubgoal.id;
  } else {
    delete goal.activeSubgoalId;
  }
}
