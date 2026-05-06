/**
 * LEGACY MODULE — Parser-derived session reconstruction.
 *
 * These functions infer progress from assistant prose, tool args,
 * plan markdown, state.md, and todo.md. They are fragile and should
 * NOT be used as the primary session-restore path.
 *
 * Primary path: HarnessState snapshot + HARNESS_STATE_EVENT_CUSTOM_TYPE replay.
 *
 * This module exists only for backwards compatibility with sessions
 * that predate structured state. New code must use structured tools.
 */

export {
  reconstructPlanProgressFromSessionEntries,
  reconstructMilestoneProgressFromSessionEntries,
  loadPlanFromAssistantMessageEnd,
  loadPlanFromToolResultEvent,
  loadMilestonesFromAssistantMessage,
  detectMilestonesFromToolResult,
  reloadPlanFromSubagentArgs,
  startPlanSubagentTasks,
  completePlanSubagentTasks,
  extractPlanPathsFromArgs,
  extractMilestonePathsFromArgs,
  startMilestonesFromSubagentArgs,
  subagentItemRecords,
  getToolExecutionArgs,
} from "./plan-progress-events.js";

export { isCompletionFilePath, extractMilestoneId } from "./milestone-tracker.js";
