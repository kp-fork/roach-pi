import type { GoalItem, GoalState, GoalVerifierReceipt, SubgoalItem } from "./goal-state.js";

export const MAX_GOAL_ATTEMPTS = 3;

export interface GoalContinuationPolicyContext {
  isRootSession: boolean;
  isTeamWorker: boolean;
  subagentDepth: number;
}

export type GoalContinuationDecision =
  | { action: "none"; reason: string }
  | {
      action: "follow_up";
      reason: "verifier_fail" | "next_target";
      targetType: "goal" | "subgoal";
      targetId: string;
      blockers: string[];
      prompt: string;
      leaseId: string;
    }
  | {
      action: "escalate";
      reason: "failure_budget_exhausted";
      targetType: "goal" | "subgoal";
      targetId: string;
      blockers: string[];
      prompt: string;
      leaseId: string;
    };

export function planGoalContinuation(
  state: GoalState,
  receipt: GoalVerifierReceipt,
  context: GoalContinuationPolicyContext,
): GoalContinuationDecision {
  if (!context.isRootSession) return { action: "none", reason: "not root session" };
  if (context.subagentDepth > 0) return { action: "none", reason: "subagent context" };
  if (context.isTeamWorker) return { action: "none", reason: "team worker context" };
  if (state.continuation.queued || state.continuation.leaseId) return { action: "none", reason: "continuation already queued" };

  const failureTarget = findTarget(state, receipt.targetType, receipt.targetId);
  if (
    failureTarget?.goal.gates?.validator === true
    && (state.continuation.consecutiveFailures[receipt.targetId] ?? 0) >= MAX_GOAL_ATTEMPTS
  ) {
    return {
      action: "escalate",
      reason: "failure_budget_exhausted",
      targetType: receipt.targetType,
      targetId: receipt.targetId,
      blockers: receipt.blockers.length > 0 ? receipt.blockers : [receipt.summary],
      prompt: buildFailureBudgetEscalationPrompt(state, receipt),
      leaseId: buildContinuationLeaseId(state, receipt, "escalate"),
    };
  }

  if (receipt.verdict === "FAIL") {
    return {
      action: "follow_up",
      reason: "verifier_fail",
      targetType: receipt.targetType,
      targetId: receipt.targetId,
      blockers: receipt.blockers,
      prompt: buildVerifierFailureContinuationPrompt(state, receipt),
      leaseId: buildContinuationLeaseId(state, receipt, "fail"),
    };
  }

  const next = findNextRunnableTarget(state, receipt);
  if (!next) return { action: "none", reason: "queue complete" };
  return {
    action: "follow_up",
    reason: "next_target",
    targetType: next.targetType,
    targetId: next.targetId,
    blockers: [],
    prompt: buildNextTargetContinuationPrompt(receipt, next),
    leaseId: buildContinuationLeaseId(state, receipt, "next"),
  };
}

export function buildVerifierFailureContinuationPrompt(state: GoalState, receipt: GoalVerifierReceipt): string {
  const target = findTarget(state, receipt.targetType, receipt.targetId);
  const objective = target?.targetType === "subgoal" ? target.subgoal.objective : target?.goal.objective ?? receipt.targetId;
  const evidenceRequired = target?.goal.evidenceRequired ?? [];
  const blockers = receipt.blockers.length > 0 ? receipt.blockers : [receipt.summary];

  if (target?.goal.gates?.validator === true) {
    return [
      `The reviewer-verifier failed ${receipt.targetType} ${receipt.targetId}.`,
      "",
      "The runtime is implementing subgoals via the isolated worker→validator loop; the blockers below will be routed into fix subgoals or retried by that loop.",
      "",
      "Objective:",
      objective,
      "",
      "Blockers:",
      formatList(blockers),
      "",
      "Run /goal (no arguments) to advance the durable runtime. Do not implement or verify anything yourself.",
    ].join("\n");
  }

  return [
    `The reviewer-verifier failed ${receipt.targetType} ${receipt.targetId}.`,
    "",
    "Objective:",
    objective,
    "",
    "Blockers:",
    formatList(blockers),
    "",
    "Required next evidence:",
    formatList(evidenceRequired),
    "",
    "Continue working on the blockers above. Do not claim complete or request completion again until the blockers are fixed and evidence has been added to the goal ledger.",
  ].join("\n");
}

export function buildFailureBudgetEscalationPrompt(state: GoalState, receipt: GoalVerifierReceipt): string {
  const target = findTarget(state, receipt.targetType, receipt.targetId);
  const objective = target?.targetType === "subgoal" ? target.subgoal.objective : target?.goal.objective ?? receipt.targetId;
  const blockers = receipt.blockers.length > 0 ? receipt.blockers : [receipt.summary];

  return [
    `The durable goal exhausted its ${MAX_GOAL_ATTEMPTS}-attempt failure budget. Stop the automatic runtime and summarize the unresolved blockers for the user:`,
    "",
    `Target: ${receipt.targetType} ${receipt.targetId}`,
    "Objective:",
    objective,
    "",
    "Unresolved blockers:",
    formatList(blockers),
  ].join("\n");
}

export function buildNextTargetContinuationPrompt(
  receipt: GoalVerifierReceipt,
  next: GoalContinuationTarget,
): string {
  return [
    `The previous ${receipt.targetType} ${receipt.targetId} passed reviewer-verifier.`,
    "",
    `Next ${next.targetType}: ${next.targetId}`,
    "Objective:",
    next.objective,
    "",
    "Required evidence:",
    formatList(next.evidenceRequired),
    "",
    "Continue with this next runnable target and maintain todos plus goal evidence before requesting completion.",
  ].join("\n");
}

interface GoalContinuationTarget {
  targetType: "goal" | "subgoal";
  targetId: string;
  objective: string;
  evidenceRequired: string[];
}

function findNextRunnableTarget(state: GoalState, receipt: GoalVerifierReceipt): GoalContinuationTarget | undefined {
  const activeGoal = state.goals.find((goal) => goal.id === state.activeGoalId && goal.status === "active");
  if (activeGoal) {
    const activeSubgoal = activeGoal.subgoals.find((subgoal) => subgoal.id === activeGoal.activeSubgoalId && subgoal.status === "active");
    if (activeSubgoal && !(receipt.targetType === "subgoal" && receipt.targetId === activeSubgoal.id)) {
      return subgoalTarget(activeGoal, activeSubgoal);
    }
    const allSubgoalsComplete = activeGoal.subgoals.length > 0 && activeGoal.subgoals.every((subgoal) => subgoal.status === "completed");
    if ((activeGoal.subgoals.length === 0 || allSubgoalsComplete) && !(receipt.targetType === "goal" && receipt.targetId === activeGoal.id)) {
      return goalTarget(activeGoal);
    }
  }

  const queuedGoal = state.goals.find((goal) => goal.status === "queued");
  if (queuedGoal) return goalTarget(queuedGoal);
  return undefined;
}

function findTarget(
  state: GoalState,
  targetType: "goal" | "subgoal",
  targetId: string,
): ({ targetType: "goal"; goal: GoalItem } | { targetType: "subgoal"; goal: GoalItem; subgoal: SubgoalItem }) | undefined {
  if (targetType === "goal") {
    const goal = state.goals.find((candidate) => candidate.id === targetId);
    return goal ? { targetType, goal } : undefined;
  }
  for (const goal of state.goals) {
    const subgoal = goal.subgoals.find((candidate) => candidate.id === targetId);
    if (subgoal) return { targetType, goal, subgoal };
  }
  return undefined;
}

function goalTarget(goal: GoalItem): GoalContinuationTarget {
  return {
    targetType: "goal",
    targetId: goal.id,
    objective: goal.objective,
    evidenceRequired: goal.evidenceRequired,
  };
}

function subgoalTarget(goal: GoalItem, subgoal: SubgoalItem): GoalContinuationTarget {
  return {
    targetType: "subgoal",
    targetId: subgoal.id,
    objective: subgoal.objective,
    evidenceRequired: goal.evidenceRequired,
  };
}

function buildContinuationLeaseId(state: GoalState, receipt: GoalVerifierReceipt, reason: "fail" | "next" | "escalate"): string {
  return `${state.runId}:${receipt.targetType}:${receipt.targetId}:${receipt.id}:${reason}`;
}

function formatList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- (none)";
}
