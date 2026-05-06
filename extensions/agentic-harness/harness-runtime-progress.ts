import { createHarnessReplayEvent, type HarnessReplayEvent } from "./harness-events.js";
import {
  applyHarnessCommand,
  type HarnessPlan,
  type HarnessPlanTaskStatus,
  type HarnessState,
} from "./harness-state.js";

function normalizePathForMatch(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function selectStructuredPlanForPaths(
  state: HarnessState,
  planPaths: string[],
): HarnessPlan | undefined {
  const normalizedPlanPaths = new Set(planPaths.map(normalizePathForMatch));
  return state.plans.find((plan) => plan.planFile && normalizedPlanPaths.has(normalizePathForMatch(plan.planFile)))
    ?? state.plans[0];
}

export function applyStructuredPlanTaskStatusUpdates(
  state: HarnessState,
  input: {
    planId: string;
    taskIds: number[];
    status: HarnessPlanTaskStatus;
    now?: string;
  },
): { state: HarnessState; events: HarnessReplayEvent[] } {
  let currentState = state;
  const events: HarnessReplayEvent[] = [];
  const uniqueTaskIds = [...new Set(input.taskIds)];

  for (const taskId of uniqueTaskIds) {
    const at = input.now ?? new Date().toISOString();
    const replayEvent = createHarnessReplayEvent(currentState, {
      type: "set_plan_task_status",
      planId: input.planId,
      taskId,
      status: input.status,
      completedAt: input.status === "completed" || input.status === "failed" ? at : undefined,
      startedAt: input.status === "running" ? at : undefined,
    }, { now: at });
    currentState = applyHarnessCommand(currentState, replayEvent.command, { now: replayEvent.at }).state;
    events.push(replayEvent);
  }

  return { state: currentState, events };
}
