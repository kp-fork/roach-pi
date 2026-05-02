import { describe, expect, it, vi } from "vitest";
import { PlanProgressTracker } from "../plan-progress.js";
import { WorkingVisibilityController } from "../working-visibility.js";

function samplePlan(): string {
  return [
    "# Visibility Plan",
    "",
    "**Goal:** Toggle working row only while plan work runs",
    "",
    "---",
    "",
    "### Task 1: Run visible task",
    "",
    "**Dependencies:** None",
    "**Files:**",
    "- Modify: `extensions/agentic-harness/index.ts`",
    "",
    "- [ ] **Step 1: Execute**",
    "",
    "Run: `npm test`",
    "Expected: pass",
    "",
  ].join("\n");
}

describe("WorkingVisibilityController", () => {
  it("hides the built-in working row only while a plan task is running", () => {
    const tracker = new PlanProgressTracker();
    tracker.loadPlan(samplePlan());
    const setWorkingVisible = vi.fn();
    const controller = new WorkingVisibilityController(tracker, { setWorkingVisible });

    controller.start();
    expect(setWorkingVisible).not.toHaveBeenCalled();

    tracker.startTask(1);
    expect(setWorkingVisible).toHaveBeenLastCalledWith(false);

    tracker.completeTask(1, true);
    expect(setWorkingVisible).toHaveBeenLastCalledWith(true);
  });

  it("restores visibility on shutdown when currently hidden", () => {
    const tracker = new PlanProgressTracker();
    tracker.loadPlan(samplePlan());
    const setWorkingVisible = vi.fn();
    const controller = new WorkingVisibilityController(tracker, { setWorkingVisible });

    controller.start();
    tracker.startTask(1);
    controller.restore();

    expect(setWorkingVisible).toHaveBeenLastCalledWith(true);
  });

  it("is a no-op on older UI objects without setWorkingVisible", () => {
    const tracker = new PlanProgressTracker();
    tracker.loadPlan(samplePlan());
    const controller = new WorkingVisibilityController(tracker, {});

    expect(() => {
      controller.start();
      tracker.startTask(1);
      controller.restore();
    }).not.toThrow();
  });
});
