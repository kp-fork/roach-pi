import type { PlanProgressTracker } from "./plan-progress.js";

type WorkingVisibilityUi = {
  setWorkingVisible?: (visible: boolean) => void;
};

export class WorkingVisibilityController {
  private unsubscribe: (() => void) | null = null;
  private hidden = false;

  constructor(
    private readonly planProgress: PlanProgressTracker,
    private readonly ui: WorkingVisibilityUi,
  ) {}

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.planProgress.subscribeOnChange(() => this.sync());
    this.sync();
  }

  sync(): void {
    if (!this.ui.setWorkingVisible) return;

    const shouldHide = this.planProgress.hasPlan()
      && this.planProgress.getProgress().running > 0;

    if (shouldHide === this.hidden) return;
    this.hidden = shouldHide;
    this.ui.setWorkingVisible(!shouldHide);
  }

  restore(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;

    if (this.hidden) {
      this.ui.setWorkingVisible?.(true);
    }
    this.hidden = false;
  }
}
